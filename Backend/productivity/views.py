import re
import secrets
import resend
from datetime import timedelta, date, datetime

from django.conf import settings
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.contrib.auth.models import User
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from urllib.parse import urlencode

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated, BasePermission
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from .models import SecuritySettings, PasswordResetOTP, Note, FocusList, ListItem, Task, RevokedAccessToken, PendingRegistration, ActiveTabSession, FocusHubProfile
from .serializers import ( NoteSerializer, NoteWriteSerializer, FocusListSerializer, ListItemSerializer, TaskSerializer )


# ---------------------------------------------------------------------
# Abstraction
# ---------------------------------------------------------------------
@method_decorator(csrf_protect, name="dispatch")
class CsrfProtectedAPIView(APIView):
    pass


@ensure_csrf_cookie
def csrf_token_view(request):
    return JsonResponse({
        "detail": "CSRF cookie set.",
        "csrfToken": get_token(request),
    })

# ---------------------------------------------------------------------
# Csrf and Authetication Protection
# ---------------------------------------------------------------------
class PublicCsrfProtectedAPIView(CsrfProtectedAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []

ACTIVE_TAB_TIMEOUT_SECONDS = 90
class IsActiveTab(BasePermission):
    message = "This tab is no longer active. Please continue in the active tab."
    def has_permission(self, request, view):
        tab_id = request.headers.get("X-FocusHub-Tab")
        if (not tab_id or not request.user or not request.user.is_authenticated):
            return False
        active_since = timezone.now() - timedelta(seconds=ACTIVE_TAB_TIMEOUT_SECONDS)
        return ActiveTabSession.objects.filter(user=request.user, tab_id=tab_id, updated_at__gte=active_since).exists()

class AuthenticatedCsrfProtectedAPIView(CsrfProtectedAPIView):
    permission_classes = [IsAuthenticated, IsActiveTab]

# ---------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------
OTP_LIFETIME_MINUTES = 3
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_RESENDS = 5
VERIFICATION_SESSION_SECONDS = 300

def is_unlocked(request):
    if not request.user or not request.user.is_authenticated:
        return False
    unlocked_user_id = request.session.get("focushub_unlocked_user_id")
    return unlocked_user_id == request.user.pk


def normalize_email(value):
    if not isinstance(value, str): return None
    email = value.strip().lower()
    if not email: return None
    try:
        validate_email(email)
    except ValidationError:
        return None
    return email

def generate_otp():
    return f"{secrets.randbelow(900000) + 100000:06d}"

def clear_otp(security, hash_field, expiry_field):
    setattr(security, hash_field, "")
    setattr(security, expiry_field, None)

def password_reset_is_verified(request, email):
    verified_email = request.session.get("otp_verified_email")
    verified_at = request.session.get("otp_verified_at")
    if verified_email != email or not verified_at:
        return False
    try:
        verified_at = float(verified_at)
    except (TypeError, ValueError):
        request.session.pop("otp_verified_email", None)
        request.session.pop("otp_verified_at", None)
        return False
    if timezone.now().timestamp() - verified_at >= VERIFICATION_SESSION_SECONDS:
        request.session.pop("otp_verified_email", None)
        request.session.pop("otp_verified_at", None)
        return False
    return True

def send_otp_email(subject, message, recipient):
    try:
        resend_api_key = getattr(settings, "RESEND_API_KEY", "")
        if resend_api_key:
            resend.api_key = resend_api_key
            response = resend.Emails.send({
                "from": "FocusHub <onboarding@resend.dev>",
                "to": [recipient],
                "subject": subject,
                "text": message,
            })
            return bool(response)
        return send_mail(subject, message, getattr(settings, "DEFAULT_FROM_EMAIL", None), [recipient], fail_silently=False) == 1
    except Exception as e:
        print(f"Email sending failed: {e}")
        return False

def otp_error_response():
    return Response({"error": "Invalid OTP or maximum verification attempts exceeded."}, status=status.HTTP_400_BAD_REQUEST)

def verify_otp(security, submitted_otp, hash_field, expiry_field, attempts_field):
    otp_hash = getattr(security, hash_field)
    expires_at = getattr(security, expiry_field)
    attempts = getattr(security, attempts_field, 0)
    if not otp_hash or not expires_at:
        return False, "No active OTP. Please request a new code."
    if timezone.now() >= expires_at:
        setattr(security, hash_field, "")
        setattr(security, expiry_field, None)
        setattr(security, attempts_field, 0)
        security.save(update_fields=[hash_field, expiry_field, attempts_field, "updated_at"])
        return False, "OTP has expired. Please request a new code."
    if attempts >= OTP_MAX_ATTEMPTS:
        return False, "Maximum OTP attempts reached. Please request a new code."
    if not check_password(str(submitted_otp).strip(), otp_hash):
        attempts += 1
        setattr(security, attempts_field, attempts)
        update_fields = [attempts_field, "updated_at"]
        if attempts >= OTP_MAX_ATTEMPTS:
            setattr(security, hash_field, "")
            setattr(security, expiry_field, None)
            update_fields.extend([hash_field, expiry_field])
        security.save(update_fields=update_fields)
        if attempts >= OTP_MAX_ATTEMPTS:
            return False, "Maximum OTP attempts reached. Please request a new code."
        remaining = OTP_MAX_ATTEMPTS - attempts
        return (False, f"Invalid OTP. {remaining} attempt(s) remaining.")
    setattr(security, hash_field, "")
    setattr(security, expiry_field, None)
    setattr(security, attempts_field, 0)
    security.save(update_fields=[hash_field, expiry_field, attempts_field, "updated_at"])
    return True, "OTP verified successfully."

def begin_otp_request(security, hash_field, expiry_field, attempts_field):
    otp = generate_otp()
    setattr(security, hash_field, make_password(otp))
    setattr(security, expiry_field, timezone.now() + timedelta(minutes=OTP_LIFETIME_MINUTES))
    setattr(security, attempts_field, 0)
    security.save(update_fields=[hash_field, expiry_field, attempts_field, "updated_at"])
    return otp

def get_security_settings(request):
    if not request.user or not request.user.is_authenticated:
        return None
    return SecuritySettings.objects.filter(user=request.user).first()

def locked_error(item_type):
    return Response({"error": f"This {item_type} is locked."}, status=status.HTTP_403_FORBIDDEN)

def filter_visible_items(queryset, request):
    if is_unlocked(request):
        return queryset
    return queryset.filter(is_locked=False)

# ---------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------
class ForgotPasswordView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.data.get("email"))
        if not email:
            return Response(
                {"error": "Please enter a valid email address."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user = User.objects.filter(email__iexact=email,is_active=True).first()
        if not user:
            return Response(
                {"error": "Email address not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        with transaction.atomic():
            reset_otp, _ = PasswordResetOTP.objects.get_or_create(user=user)
            reset_otp = PasswordResetOTP.objects.select_for_update().get(pk=reset_otp.pk)
            now = timezone.now()
            had_previous_send = bool(reset_otp.otp_last_sent_at)
            if had_previous_send:
                elapsed = (now - reset_otp.otp_last_sent_at).total_seconds()
                if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                    remaining = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed) + 1
                    return Response(
                        {
                            "error": "Please wait before requesting another OTP.",
                            "retry_after": remaining,
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
                if reset_otp.otp_resend_count >= OTP_MAX_RESENDS:
                    return Response(
                        {
                            "error": "Maximum OTP resend limit reached. Please try again later."
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
            otp = generate_otp()
            reset_otp.otp_hash = make_password(otp)
            reset_otp.otp_expires_at = (now + timedelta(minutes=OTP_LIFETIME_MINUTES))
            reset_otp.otp_attempts = 0
            reset_otp.otp_last_sent_at = now
            if had_previous_send:
                reset_otp.otp_resend_count += 1
            reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_last_sent_at", "otp_resend_count", "updated_at"])
            if not send_otp_email(
                "FocusHub Password Reset OTP",
                (
                    f"Your FocusHub password reset OTP is: {otp}\n\n"
                    f"This OTP is valid for {OTP_LIFETIME_MINUTES} minutes. "
                    "Do not share this code with anyone."
                ),
                user.email
            ):
                clear_otp(reset_otp, "otp_hash", "otp_expires_at")
                reset_otp.otp_attempts = 0
                reset_otp.otp_last_sent_at = None
                if had_previous_send:
                    reset_otp.otp_resend_count -= 1
                else:
                    reset_otp.otp_resend_count = 0
                reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_last_sent_at", "otp_resend_count", "updated_at"])
                return Response(
                    {
                        "error": "Could not send the email. Please try again."
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            request.session.pop("otp_verified_email", None)
            request.session.pop("otp_verified_at", None)
        return Response(
            {
                "message": "OTP sent successfully.",
                "expires_in": OTP_LIFETIME_MINUTES * 60,
                "resends_remaining": (
                    OTP_MAX_RESENDS - reset_otp.otp_resend_count
                ),
            },
            status=status.HTTP_200_OK
        )


class OTPVerifyView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.data.get("email"))
        otp = request.data.get("otp")
        if not email or not isinstance(otp, str) or not otp.strip():
            return Response(
                {"error": "A valid email and OTP are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        otp = otp.strip()
        if not otp.isdigit() or len(otp) != 6:
            return Response(
                {"error": "Please enter a valid six-digit OTP."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            return Response(
                {"error": "Email address not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        with transaction.atomic():
            reset_otp = (PasswordResetOTP.objects.select_for_update().filter(user=user).first())
            if not reset_otp:
                return Response(
                    {"error": "No active OTP. Please request a new code."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            is_valid, message = verify_otp(reset_otp, otp, "otp_hash", "otp_expires_at", "otp_attempts")
            if not is_valid:
                response_status = (
                    status.HTTP_429_TOO_MANY_REQUESTS
                    if "Maximum OTP attempts" in message
                    else status.HTTP_400_BAD_REQUEST
                )
                return Response(
                    {"error": message},
                    status=response_status
                )
            reset_token = secrets.token_urlsafe(32)
            reset_otp.otp_hash = make_password(reset_token)
            reset_otp.otp_expires_at = (timezone.now() + timedelta(minutes=10))
            reset_otp.otp_attempts = 0
            reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "updated_at"])
            frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
            reset_link = (
                f"{frontend_url}/create-password?"
                f"{urlencode({'email': user.email, 'token': reset_token})}"
            )
            request.session.pop("otp_verified_email", None)
            request.session.pop("otp_verified_at", None)
        email_sent = send_otp_email(
            "FocusHub Create New Password",
            (
                "Your OTP has been verified successfully.\n\n"
                "Open the link below to create a new FocusHub password:\n\n"
                f"{reset_link}\n\n"
                "This link expires in 10 minutes and can be used only once. "
                "If you did not request a password reset, ignore this email."
            ),
            user.email
        )
        if not email_sent:
            with transaction.atomic():
                reset_otp = (PasswordResetOTP.objects.select_for_update().filter(user=user).first())
                if (reset_otp and reset_otp.otp_hash and check_password(reset_token, reset_otp.otp_hash)):
                    reset_otp.otp_hash = ""
                    reset_otp.otp_expires_at = None
                    reset_otp.otp_attempts = 0
                    reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "updated_at"])
            return Response(
                {
                    "error": (
                        "OTP verified, but the reset email could not be sent. "
                        "Request a new OTP."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        return Response(
            {
                "message": (
                    "OTP verified. A password reset link has been emailed to you."
                )
            },
            status=status.HTTP_200_OK
        )


class ResetPasswordView(PublicCsrfProtectedAPIView):
    def post(self, request):
        raw_email = request.data.get("email")
        if not isinstance(raw_email, str) or not raw_email.strip():
            return Response(
                {"error": "The reset link is invalid. Please request a new link."},
                status=status.HTTP_400_BAD_REQUEST
            )
        email = normalize_email(raw_email)
        if not email:
            return Response(
                {"error": "The reset link is invalid. Please request a new link."},
                status=status.HTTP_400_BAD_REQUEST
            )
        token = request.data.get("token")
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")
        if not isinstance(token, str) or not token:
            return Response(
                {"error": "The reset link is invalid. Please request a new link."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if (not isinstance(new_password, str) or not isinstance(confirm_password, str) or not new_password or not confirm_password):
            return Response(
                {"error": "Please enter both password fields."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if new_password != confirm_password:
            return Response(
                {"error": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            return Response(
                {"error": "Account not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        try:
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=user.pk)
                reset_otp = (PasswordResetOTP.objects.select_for_update().filter(user=user).first())
                if (not reset_otp or not reset_otp.otp_hash or not reset_otp.otp_expires_at):
                    return Response(
                        {"error": "This reset link is invalid or has already been used."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                if timezone.now() >= reset_otp.otp_expires_at:
                    clear_otp(reset_otp, "otp_hash", "otp_expires_at")
                    reset_otp.otp_attempts = 0
                    reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "updated_at" ])
                    return Response(
                        {"error": "This reset link has expired. Please request a new one."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                if not check_password(token, reset_otp.otp_hash):
                    return Response(
                        {"error": "Invalid password reset link."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                try:
                    validate_password(new_password, user=user)
                except ValidationError as exc:
                    return Response(
                        {"error": list(exc.messages)},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                profile = (FocusHubProfile.objects.select_for_update().filter(user=user).first())
                if not profile:
                    return Response(
                        {"error": "User profile not found. Please contact support."},
                        status=status.HTTP_404_NOT_FOUND
                    )
                user.set_password(new_password)
                user.save(update_fields=["password"])
                profile.token_version += 1
                profile.save(update_fields=["token_version"])
                outstanding_tokens = OutstandingToken.objects.filter(user=user)
                for outstanding in outstanding_tokens:
                    try:
                        RefreshToken(outstanding.token).blacklist()
                    except TokenError:
                        continue
                clear_otp(reset_otp, "otp_hash", "otp_expires_at")
                reset_otp.otp_attempts = 0
                reset_otp.otp_resend_count = 0
                reset_otp.otp_last_sent_at = None
                reset_otp.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_resend_count", "otp_last_sent_at", "updated_at"])
                ActiveTabSession.objects.filter(user=user).delete()
        except Exception:
            return Response(
                {"error": "Could not reset the password. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        request.session.pop("otp_verified_email", None)
        request.session.pop("otp_verified_at", None)
        request.session.pop("focushub_unlocked_user_id", None)
        request.session.cycle_key()
        return Response(
            {"message": "Password reset successfully. Please log in again."},
            status=status.HTTP_200_OK
        )


class UnlockStatusView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        return Response({"unlocked": is_unlocked(request)}, status=status.HTTP_200_OK)


class LockView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        request.session.pop("focushub_unlocked", None)
        request.session.pop("focushub_unlocked_user_id", None)
        request.session.pop("otp_verified_email", None)
        request.session.pop("otp_verified_at", None)
        return Response(
            {"message": "FocusHub locked successfully."},
            status=status.HTTP_200_OK,
        )


class ChangePasswordView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        current_password = request.data.get("current_password")
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")
        if not all(
            isinstance(value, str) and value
            for value in (current_password, new_password, confirm_password)
        ):
            return Response(
                {
                    "error": (
                        "Current password, new password and "
                        "confirmation are required."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        if new_password != confirm_password:
            return Response(
                {"error": "New passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        security = get_security_settings(request)
        if not security:
            return Response(
                {"error": "Password has not been configured yet."},
                status=status.HTTP_404_NOT_FOUND
            )
        if not check_password(current_password, security.password_hash):
            return Response(
                {"error": "Current password is incorrect."},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if current_password == new_password:
            return Response(
                {"error": "New password must be different from the current password."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            validate_password(new_password, user=request.user)
        except ValidationError as error:
            return Response(
                {"error": list(error.messages)},
                status=status.HTTP_400_BAD_REQUEST
            )
        security.password_hash = make_password(new_password)
        security.save(update_fields=["password_hash", "updated_at"])
        request.session.cycle_key()
        request.session["focushub_unlocked_user_id"] = request.user.pk
        return Response(
            {"message": "Password changed successfully."},
            status=status.HTTP_200_OK
        )


class CardLockOTPRequestView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.user.email)
        if not email:
            return Response(
                {"error": "Your registered email address is invalid."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            security = (
                SecuritySettings.objects
                .select_for_update()
                .filter(user=request.user)
                .first()
            )
            if not security:
                return Response(
                    {
                        "error": (
                            "Set up your Card Lock Password recovery "
                            "details first."
                        )
                    },
                    status=status.HTTP_404_NOT_FOUND
                )
            if normalize_email(security.email) != email:
                return Response(
                    {
                        "error": (
                            "Your registered email does not match "
                            "your Card Lock settings."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            now = timezone.now()
            had_previous_send = bool(security.otp_last_sent_at)
            if had_previous_send:
                elapsed = (
                    now - security.otp_last_sent_at
                ).total_seconds()
                if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                    return Response(
                        {
                            "error": (
                                "Please wait before requesting another OTP."
                            ),
                            "retry_after": (
                                int(
                                    OTP_RESEND_COOLDOWN_SECONDS - elapsed
                                ) + 1
                            )
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
                if security.otp_resend_count >= OTP_MAX_RESENDS:
                    return Response(
                        {
                            "error": (
                                "Maximum OTP resend limit reached. "
                                "Please try again later."
                            )
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
            otp = generate_otp()
            security.otp_hash = make_password(otp)
            security.otp_expires_at = (
                now + timedelta(minutes=OTP_LIFETIME_MINUTES)
            )
            security.otp_attempts = 0
            security.otp_last_sent_at = now
            if had_previous_send:
                security.otp_resend_count += 1
            security.save(
                update_fields=[
                    "otp_hash",
                    "otp_expires_at",
                    "otp_attempts",
                    "otp_last_sent_at",
                    "otp_resend_count",
                    "updated_at",
                ]
            )
            email_sent = send_otp_email(
                "FocusHub Card Lock Password Recovery OTP",
                (
                    f"Your Card Lock Password recovery OTP is: {otp}\n\n"
                    f"This OTP expires in {OTP_LIFETIME_MINUTES} minutes. "
                    "Do not share it with anyone."
                ),
                email
            )
            if not email_sent:
                clear_otp(
                    security,
                    "otp_hash",
                    "otp_expires_at"
                )
                security.otp_attempts = 0
                security.otp_last_sent_at = None
                if had_previous_send:
                    security.otp_resend_count -= 1
                else:
                    security.otp_resend_count = 0
                security.save(
                    update_fields=[
                        "otp_hash",
                        "otp_expires_at",
                        "otp_attempts",
                        "otp_last_sent_at",
                        "otp_resend_count",
                        "updated_at",
                    ]
                )
                return Response(
                    {
                        "error": (
                            "Unable to send the OTP. Please try again."
                        )
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
        return Response(
            {
                "message": (
                    "Card Lock recovery OTP sent to your registered email."
                ),
                "email": email,
                "expires_in": OTP_LIFETIME_MINUTES * 60,
                "resends_remaining": (
                    OTP_MAX_RESENDS - security.otp_resend_count
                ),
            },
            status=status.HTTP_200_OK
        )


class CardLockOTPVerifyView(AuthenticatedCsrfProtectedAPIView):
    verification_session_key = "focushub_card_lock_reset_verified"
    verification_lifetime = VERIFICATION_SESSION_SECONDS
    def post(self, request):
        otp = request.data.get("otp")
        if not isinstance(otp, str) or not otp.strip():
            return Response(
                {"error": "Please enter the OTP sent to your email."},
                status=status.HTTP_400_BAD_REQUEST
            )
        otp = otp.strip()
        if not otp.isdigit() or len(otp) != 6:
            return Response(
                {"error": "Please enter a valid six-digit OTP."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user_email = normalize_email(request.user.email)
        if not user_email:
            return Response(
                {"error": "Your registered email address is invalid."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            security = (
                SecuritySettings.objects
                .select_for_update()
                .filter(user=request.user)
                .first()
            )
            if not security:
                return Response(
                    {"error": "Card Lock Password settings were not found."},
                    status=status.HTTP_404_NOT_FOUND
                )
            security_email = normalize_email(security.email)
            if not security_email or security_email != user_email:
                return Response(
                    {
                        "error": (
                            "Your registered email does not match "
                            "your Card Lock settings."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            verified, message = verify_otp(
                security,
                otp,
                "otp_hash",
                "otp_expires_at",
                "otp_attempts"
            )
            if not verified:
                response_status = (
                    status.HTTP_429_TOO_MANY_REQUESTS
                    if "Maximum OTP attempts" in message
                    else status.HTTP_400_BAD_REQUEST
                )

                return Response(
                    {"error": message},
                    status=response_status
                )
            request.session.cycle_key()
            request.session[self.verification_session_key] = {
                "user_id": request.user.pk,
                "verified_at": timezone.now().timestamp()
            }
            request.session.modified = True
        return Response(
            {
                "message": (
                    "OTP verified. You can now reset your Card Lock Password."
                )
            },
            status=status.HTTP_200_OK
        )


class CardLockPasswordResetView(AuthenticatedCsrfProtectedAPIView):
    verification_session_key = "focushub_card_lock_reset_verified"
    verification_lifetime = VERIFICATION_SESSION_SECONDS
    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        verification = request.session.get(
            self.verification_session_key
        )
        if not isinstance(verification, dict):
            return Response(
                {"error": "Please verify the recovery OTP first."},
                status=status.HTTP_403_FORBIDDEN
            )
        verified_at = verification.get("verified_at")
        now = timezone.now().timestamp()
        if (
            verification.get("user_id") != request.user.pk
            or not isinstance(verified_at, (int, float))
            or isinstance(verified_at, bool)
            or now < verified_at
            or now - verified_at > self.verification_lifetime
        ):
            request.session.pop(self.verification_session_key, None)
            request.session.modified = True
            return Response(
                {
                    "error": (
                        "OTP verification expired. Please request a new OTP."
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")
        if (
            not isinstance(new_password, str)
            or not isinstance(confirm_password, str)
            or not new_password
            or not confirm_password
        ):
            return Response(
                {"error": "Please enter both password fields."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if new_password != confirm_password:
            return Response(
                {"error": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if len(new_password) < 8:
            return Response(
                {"error": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            with transaction.atomic():
                security = (
                    SecuritySettings.objects
                    .select_for_update()
                    .filter(user=request.user)
                    .first()
                )
                if not security:
                    return Response(
                        {"error": "Card Lock Password settings were not found."},
                        status=status.HTTP_404_NOT_FOUND
                    )
                if check_password(
                    new_password,
                    security.password_hash
                ):
                    return Response(
                        {
                            "error": (
                                "Choose a password different from your "
                                "current Card Lock Password."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST
                    )
                try:
                    validate_password(
                        new_password,
                        user=request.user
                    )
                except ValidationError as exc:
                    return Response(
                        {"error": list(exc.messages)},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                security.password_hash = make_password(new_password)
                security.otp_resend_count = 0
                security.otp_last_sent_at = None
                security.save(
                    update_fields=[
                        "password_hash",
                        "otp_resend_count",
                        "otp_last_sent_at",
                        "updated_at",
                    ]
                )
        except Exception:
            return Response(
                {"error": "Could not reset the Card Lock Password. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        request.session.pop(self.verification_session_key, None)
        request.session.pop("focushub_unlocked_user_id", None)
        request.session.modified = True
        return Response(
            {
                "message": (
                    "Card Lock Password reset successfully. "
                    "Unlock your cards again."
                )
            },
            status=status.HTTP_200_OK
        )


class PasswordSetupView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.data.get("email"))
        password = request.data.get("password")
        confirm_password = request.data.get("confirm_password")
        if not email:
            return Response(
                {"error": "A valid email is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not isinstance(password, str) or not isinstance(confirm_password, str):
            return Response(
                {"error": "Password values must be strings."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not password or not confirm_password:
            return Response(
                {"error": "Password and confirmation are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if password != confirm_password:
            return Response(
                {"error": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if email != request.user.email.strip().lower():
            return Response(
                {"error": "Use your registered email address."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if SecuritySettings.objects.filter(user=request.user).exists():
            return Response(
                {"error": "Card Lock Password has already been configured."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if SecuritySettings.objects.filter(email=email).exists():
            return Response(
                {"error": "This email is already associated with a security setting."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            validate_password(password, user=request.user)
        except ValidationError as error:
            return Response(
                {"error": list(error.messages)},
                status=status.HTTP_400_BAD_REQUEST
            )
        security = SecuritySettings.objects.create(user=request.user, email=email, password_hash=make_password(password))
        request.session.cycle_key()
        request.session["focushub_unlocked_user_id"] = request.user.pk
        return Response(
            {
                "message": "Card Lock Password created successfully.",
                "email": security.email,
            },
            status=status.HTTP_201_CREATED
        )

class PasswordVerifyView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        password = request.data.get("password")
        if not isinstance(password, str) or not password:
            return Response(
                {"error": "Password is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        security = get_security_settings(request)
        if not security:
            return Response(
                {"error": "Card Lock Password has not been configured yet."},
                status=status.HTTP_404_NOT_FOUND
            )
        if not check_password(password, security.password_hash):
            return Response(
                {"error": "Incorrect password."},
                status=status.HTTP_401_UNAUTHORIZED
            )
        request.session.cycle_key()
        request.session["focushub_unlocked_user_id"] = request.user.pk
        return Response({"message": "Password verified successfully."}, status=status.HTTP_200_OK)


class ChangeLoginPasswordView(AuthenticatedCsrfProtectedAPIView):
    verification_session_key = "focushub_login_password_change"
    verification_lifetime = 300
    def post(self, request):
        from django.utils import timezone
        user = request.user
        current_password = request.data.get("current_password")
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")
        if request.path.endswith("/change-login/"):
            return Response(
                {
                    "error": (
                        "Please verify your current password first, "
                        "then complete the password change."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        if request.path.endswith("/verify/"):
            if not isinstance(current_password, str) or not current_password:
                return Response(
                    {"error": "Current password is required."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if not user.check_password(current_password):
                request.session.pop(self.verification_session_key, None)
                request.session.modified = True
                return Response(
                    {"error": "Current login password is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            request.session[self.verification_session_key] = {
                "user_id": user.pk,
                "verified_at": timezone.now().timestamp()
            }
            request.session.modified = True
            return Response(
                {"message": "Current password verified."},
                status=status.HTTP_200_OK
            )
        if not request.path.endswith("/complete/"):
            return Response(
                {"error": "Invalid password-change endpoint."},
                status=status.HTTP_400_BAD_REQUEST
            )
        verification = request.session.get(self.verification_session_key)
        if not isinstance(verification, dict):
            return Response(
                {"error": "Please verify your current password again."},
                status=status.HTTP_403_FORBIDDEN
            )
        verified_at = verification.get("verified_at")
        now = timezone.now().timestamp()
        if (
            verification.get("user_id") != user.pk
            or not isinstance(verified_at, (int, float))
            or now < verified_at
            or now - verified_at > self.verification_lifetime
        ):
            request.session.pop(self.verification_session_key,None)
            request.session.modified = True
            return Response(
                {
                    "error": (
                        "Verification expired. Please verify "
                        "your current password again."
                    )
                },
                status=status.HTTP_403_FORBIDDEN
            )
        if not all(isinstance(value, str) and value for value in (new_password, confirm_password)):
            return Response(
                {
                    "error": (
                        "New password and confirmation are required."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        if new_password != confirm_password:
            return Response(
                {"error": "New passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if user.check_password(new_password):
            return Response(
                {
                    "error": (
                        "Your new password must be different "
                        "from your current password."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            validate_password(new_password, user=user)
        except ValidationError as exc:
            return Response(
                {"error": list(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            with transaction.atomic():
                locked_user = User.objects.select_for_update().get(pk=user.pk)
                profile = FocusHubProfile.objects.select_for_update().filter(user=locked_user).first()
                if not profile:
                    return Response(
                        {"error": "User profile not found."},
                        status=status.HTTP_404_NOT_FOUND
                    )
                locked_user.set_password(new_password)
                locked_user.save(update_fields=["password"])
                profile.token_version += 1
                profile.save(update_fields=["token_version"])
                outstanding_tokens = OutstandingToken.objects.filter(user=locked_user)
                for outstanding in outstanding_tokens:
                    try:
                        RefreshToken(outstanding.token).blacklist()
                    except TokenError:
                        continue
                ActiveTabSession.objects.filter(user=locked_user).delete()
        except Exception:
            return Response(
                {
                    "error": (
                        "Could not change the login password. "
                        "Please try again."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        request.session.pop(self.verification_session_key, None)
        request.session.modified = True
        return Response(
            {
                "message": (
                    "Login password changed successfully. "
                    "Please log in again."
                )
            },
            status=status.HTTP_200_OK
        )

# ---------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------
class LoginView(PublicCsrfProtectedAPIView):
    ACTIVE_TAB_TIMEOUT = timedelta(seconds=90)
    def post(self, request):
        email = request.data.get("email", "")
        password = request.data.get("password", "")
        tab_id = request.data.get("tab_id", "")
        takeover = request.data.get("takeover", False)
        if not isinstance(email, str) or not isinstance(password, str):
            return Response(
                {"error": "Invalid email or password."},
                status=status.HTTP_400_BAD_REQUEST
            )
        email = email.strip().lower()
        if not email or not password:
            return Response(
                {"error": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not isinstance(tab_id, str) or not tab_id.strip() or len(tab_id) > 100:
            return Response(
                {"error": "A valid tab ID is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        tab_id = tab_id.strip()
        if not isinstance(takeover, bool):
            return Response(
                {"error": "Invalid active-tab confirmation."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.check_password(password):
            return Response(
                {"error": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if not user.is_active:
            return Response(
                {"error": "This account is inactive."},
                status=status.HTTP_403_FORBIDDEN
            )
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user.pk)
            profile = FocusHubProfile.objects.select_for_update().filter(user=user).first()
            if not profile:
                return Response(
                    {"error": "User profile not found. Please contact support."},
                    status=status.HTTP_403_FORBIDDEN
                )
            active_session = ActiveTabSession.objects.select_for_update().filter(user=user).first()
            now = timezone.now()
            if active_session:
                same_tab = active_session.tab_id == tab_id
                stale_tab = (now - active_session.updated_at > self.ACTIVE_TAB_TIMEOUT)
                if not same_tab and not stale_tab and not takeover:
                    return Response(
                        {
                            "active_elsewhere": True,
                            "message": (
                                "You are already logged in another tab. "
                                "Do you want to make this tab active?"
                            ),
                        },
                        status=status.HTTP_409_CONFLICT
                    )
                if not same_tab:
                    active_session.tab_id = tab_id
                active_session.save(update_fields=["tab_id", "updated_at"])
            else:
                ActiveTabSession.objects.create(user=user, tab_id=tab_id)
            refresh = RefreshToken.for_user(user)
            refresh["token_version"] = profile.token_version
            access = refresh.access_token
            return Response(
                {
                    "message": "Login successful.",
                    "user": {
                        "id": user.id,
                        "full_name": profile.full_name,
                        "email": user.email,
                        "date_of_birth": (
                            str(profile.date_of_birth)
                            if profile.date_of_birth else None
                        ),
                        "mobile_number": profile.mobile_number,
                    },
                    "refresh": str(refresh),
                    "access": str(access),
                },
                status=status.HTTP_200_OK
            )


class RegisterView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.data.get("email"))
        if not email:
            return Response(
                {"error": "Please enter a valid email address."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"error": "An account with this email already exists."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            pending, created = PendingRegistration.objects.get_or_create(
                email=email,
                defaults={"full_name": "", "password_hash": "", "date_of_birth": None, "mobile_number": ""}
            )
            pending = PendingRegistration.objects.select_for_update().get(pk=pending.pk)
            if pending.email_verified:
                return Response(
                    {"error": "Email is already verified. Please complete registration."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            now = timezone.now()
            if not created:
                if pending.otp_last_sent_at:
                    elapsed = (now - pending.otp_last_sent_at).total_seconds()
                    if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                        remaining = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed) + 1
                        return Response(
                            {
                                "error": "Please wait before requesting another OTP.",
                                "retry_after": remaining,
                            },
                            status=status.HTTP_429_TOO_MANY_REQUESTS
                        )
                if pending.otp_resend_count >= OTP_MAX_RESENDS:
                    return Response(
                        {
                            "error": "Maximum OTP resend limit reached. Please try again later."
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
            otp = generate_otp()
            pending.otp_hash = make_password(otp)
            pending.otp_expires_at = (now + timedelta(minutes=OTP_LIFETIME_MINUTES))
            pending.otp_attempts = 0
            pending.email_verified = False
            pending.otp_last_sent_at = now
            if not created:
                pending.otp_resend_count += 1
            pending.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "email_verified", "otp_last_sent_at", "otp_resend_count", "updated_at"])
            if not send_otp_email(
                "FocusHub Email Verification OTP",
                (
                    f"Your FocusHub email verification OTP is: {otp}\n\n"
                    "This OTP is valid for 3 minutes. "
                    "Do not share this code with anyone."
                ),
                email
            ):
                clear_otp(pending, "otp_hash", "otp_expires_at")
                pending.otp_attempts = 0
                pending.otp_last_sent_at = None
                if not created:
                    pending.otp_resend_count -= 1
                else:
                    pending.otp_resend_count = 0
                pending.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_last_sent_at", "otp_resend_count", "updated_at"])
                return Response(
                    {
                        "error": "Could not send the verification email. Please try again."
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
        return Response(
            {
                "message": "Verification OTP sent successfully.",
                "expires_in": OTP_LIFETIME_MINUTES * 60,
                "resends_remaining": OTP_MAX_RESENDS - pending.otp_resend_count,
            },
            status=status.HTTP_200_OK
        )


class RegisterOTPVerifyView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = request.data.get("email", "")
        otp = request.data.get("otp", "")
        if not isinstance(email, str) or not isinstance(otp, str):
            return Response(
                {"error": "Email and OTP are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        email = email.strip().lower()
        otp = otp.strip()
        if not email or not otp.isdigit() or len(otp) != 6:
            return Response(
                {"error": "Enter a valid email and six-digit OTP."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            pending = (PendingRegistration.objects.select_for_update().filter(email__iexact=email).first())
            if not pending:
                return Response(
                    {
                        "error": "Registration request not found. Please send a new OTP."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            if pending.email_verified:
                return Response(
                    {"message": "Email is already verified."},
                    status=status.HTTP_200_OK
                )
            if not pending.otp_hash or not pending.otp_expires_at:
                return Response(
                    {"error": "No active OTP. Please request a new code."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if timezone.now() >= pending.otp_expires_at:
                pending.otp_hash = ""
                pending.otp_expires_at = None
                pending.otp_attempts = 0
                pending.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "updated_at"])
                return Response(
                    {"error": "OTP expired. Please resend the OTP."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if pending.otp_attempts >= OTP_MAX_ATTEMPTS:
                return Response(
                    {
                        "error": "Too many incorrect attempts. Please resend the OTP."
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS
                )
            if not check_password(otp, pending.otp_hash):
                pending.otp_attempts += 1
                update_fields = ["otp_attempts", "updated_at"]
                if pending.otp_attempts >= OTP_MAX_ATTEMPTS:
                    pending.otp_hash = ""
                    pending.otp_expires_at = None
                    update_fields.extend(["otp_hash", "otp_expires_at"])
                pending.save(update_fields=update_fields)
                if pending.otp_attempts >= OTP_MAX_ATTEMPTS:
                    return Response(
                        {
                            "error": "Too many incorrect attempts. Please resend the OTP.",
                            "attempts_remaining": 0,
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
                return Response(
                    {
                        "error": "Incorrect OTP.",
                        "attempts_remaining": (
                            OTP_MAX_ATTEMPTS - pending.otp_attempts
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            if User.objects.filter(email__iexact=email).exists():
                pending.delete()
                return Response(
                    {"error": "An account with this email already exists."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            pending.email_verified = True
            pending.otp_hash = ""
            pending.otp_expires_at = None
            pending.otp_attempts = 0
            pending.save(update_fields=[ "email_verified", "otp_hash", "otp_expires_at", "otp_attempts", "updated_at"])
        return Response(
            {"message": "Email verified successfully."},
            status=status.HTTP_200_OK
        )


class RegisterOTPResendView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = normalize_email(request.data.get("email"))
        if not email:
            return Response(
                {"error": "Please enter a valid email address."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"error": "An account with this email already exists."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            pending = (PendingRegistration.objects.select_for_update().filter(email__iexact=email).first())
            if not pending:
                return Response(
                    {
                        "error": "Registration request not found. Please request an OTP first."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            if pending.email_verified:
                return Response(
                    {"error": "Email is already verified."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if pending.otp_resend_count >= OTP_MAX_RESENDS:
                return Response(
                    {
                        "error": "Maximum OTP resend limit reached. Please try again later."
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS
                )
            now = timezone.now()
            if pending.otp_last_sent_at:
                elapsed = (now - pending.otp_last_sent_at).total_seconds()
                if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
                    remaining = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed) + 1
                    return Response(
                        {
                            "error": "Please wait before requesting another OTP.",
                            "retry_after": remaining,
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS
                    )
            otp = generate_otp()
            pending.otp_hash = make_password(otp)
            pending.otp_expires_at = (now + timedelta(minutes=OTP_LIFETIME_MINUTES))
            pending.otp_attempts = 0
            pending.otp_last_sent_at = now
            pending.otp_resend_count += 1
            pending.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_last_sent_at", "otp_resend_count", "updated_at"])
            if not send_otp_email(
                "FocusHub Email Verification OTP",
                (
                    f"Your FocusHub email verification OTP is: {otp}\n\n"
                    "This OTP is valid for 3 minutes. "
                    "Do not share this code with anyone."
                ),
                email
            ):
                clear_otp(pending, "otp_hash", "otp_expires_at")
                pending.otp_attempts = 0
                pending.otp_last_sent_at = None
                pending.otp_resend_count -= 1
                pending.save(update_fields=["otp_hash", "otp_expires_at", "otp_attempts", "otp_last_sent_at", "otp_resend_count", "updated_at"])
                return Response(
                    {
                        "error": "Could not resend the verification email. Please try again."
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
        return Response(
            {
                "message": "A new verification OTP has been sent.",
                "expires_in": OTP_LIFETIME_MINUTES * 60,
                "resends_remaining": OTP_MAX_RESENDS - pending.otp_resend_count,
            },
            status=status.HTTP_200_OK
        )


class CompleteRegistrationView(PublicCsrfProtectedAPIView):
    def post(self, request):
        email = request.data.get("email", "")
        tab_id = request.data.get("tab_id", "")
        if not isinstance(email, str) or not email.strip() or not isinstance(tab_id, str) or not tab_id.strip() or len(tab_id) > 100:
            return Response(
                {"error": "A valid email and tab ID are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        email, tab_id = email.strip().lower(), tab_id.strip()
        try:
            validate_email(email)
        except ValidationError:
            return Response(
                {"error": "Please enter a valid email address."},
                status=status.HTTP_400_BAD_REQUEST
            )
        full_name = request.data.get("full_name", "")
        password = request.data.get("password", "")
        confirm_password = request.data.get("confirm_password", "")
        date_of_birth = request.data.get("date_of_birth", "")
        mobile_number = request.data.get("mobile_number", "")
        if not all(isinstance(value, str) and value.strip() for value in (full_name, password, confirm_password, date_of_birth, mobile_number)):
            return Response(
                {"error": "Please complete all registration fields."},
                status=status.HTTP_400_BAD_REQUEST
            )
        full_name, mobile_number = full_name.strip(), mobile_number.strip()
        if len(full_name) > 150:
            return Response(
                {"error": "Full name must not exceed 150 characters."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if password != confirm_password:
            return Response(
                {"error": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            validate_password(password)
        except ValidationError as error:
            return Response(
                {"error": list(error.messages)},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            dob = date.fromisoformat(date_of_birth)
        except ValueError:
            return Response(
                {"error": "Please enter a valid date of birth."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if dob >= timezone.localdate():
            return Response(
                {"error": "Date of birth must be in the past."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if len(mobile_number) > 20 or not re.fullmatch(r"\+?[1-9]\d{1,14}", mobile_number):
            return Response(
                {"error": "Please enter a valid mobile number."},
                status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            pending = PendingRegistration.objects.select_for_update().filter(email__iexact=email).first()
            if not pending:
                return Response(
                    {"error": "Registration details not found. Please start registration again."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if not pending.email_verified:
                return Response(
                    {"error": "Please verify your email before registering."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if User.objects.filter(email__iexact=email).exists():
                return Response(
                    {"error": "An account with this email already exists."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            user = User(username=email, email=email, first_name=full_name)
            user.set_password(password)
            user.save(force_insert=True)
            FocusHubProfile.objects.create(user=user, full_name=full_name, date_of_birth=dob, mobile_number=mobile_number)
            ActiveTabSession.objects.update_or_create(user=user, defaults={"tab_id": tab_id})
            pending.delete()
        return Response(
            {"message": "Registration successful. Please log in."},
            status=status.HTTP_201_CREATED
        )


class ActiveTabReleaseView(PublicCsrfProtectedAPIView):
    def post(self, request):
        tab_id = request.data.get("tab_id")
        if tab_id is None:
            tab_id = request.headers.get("X-FocusHub-Tab", "")
        if not isinstance(tab_id, str):
            return Response(
                {"error": "A valid tab ID is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        tab_id = tab_id.strip()
        refresh_token = request.data.get("refresh")
        if (not tab_id or len(tab_id) > 100 or not isinstance(refresh_token, str) or not refresh_token.strip()):
            return Response(
                {"error": "Refresh token and valid tab ID are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        refresh_token = refresh_token.strip()
        try:
            refresh = RefreshToken(refresh_token)
            refresh.check_blacklist()
            user_id = refresh["user_id"]
            token_version = refresh.get("token_version")
            if token_version is None:
                return Response(
                    {"error": "Invalid session. Please log in again."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            profile = FocusHubProfile.objects.filter(user_id=user_id).only("token_version").first()
            if not profile or token_version != profile.token_version:
                return Response(
                    {"error": "Your session has expired. Please log in again."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            deleted, _ = ActiveTabSession.objects.filter(user_id=user_id, tab_id=tab_id).delete()
            return Response(
                {
                    "released": deleted > 0,
                    "message": (
                        "Active tab session released."
                        if deleted > 0
                        else "This tab did not own the active session."
                    )
                },
                status=status.HTTP_200_OK
            )
        except (TokenError, KeyError, TypeError, ValueError):
            return Response(
                {"error": "Invalid or expired refresh token."},
                status=status.HTTP_401_UNAUTHORIZED
            )


class ActiveTabClaimView(PublicCsrfProtectedAPIView):
    ACTIVE_TAB_TIMEOUT = timedelta(seconds=90)

    def post(self, request):
        refresh_token = request.data.get("refresh")
        tab_id = request.headers.get("X-FocusHub-Tab", "")
        takeover = request.data.get("takeover", False)

        if not isinstance(takeover, bool):
            return Response(
                {"error": "Invalid takeover value."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not isinstance(tab_id, str):
            return Response(
                {"error": "A valid tab ID is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        tab_id = tab_id.strip()

        if (
            not tab_id
            or len(tab_id) > 100
            or not isinstance(refresh_token, str)
            or not refresh_token.strip()
        ):
            return Response(
                {"error": "Refresh token and valid tab ID are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        refresh_token = refresh_token.strip()

        try:
            refresh = RefreshToken(refresh_token)
            refresh.check_blacklist()

            user_id = refresh["user_id"]
            token_version = refresh.get("token_version")

            if token_version is None:
                return Response(
                    {"error": "Invalid session. Please log in again."},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            user = User.objects.filter(
                pk=user_id,
                is_active=True
            ).first()

            if not user:
                return Response(
                    {"error": "Invalid user session."},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            profile = (
                FocusHubProfile.objects
                .filter(user=user)
                .only("token_version")
                .first()
            )

            if not profile or token_version != profile.token_version:
                return Response(
                    {
                        "error": (
                            "Your session has expired. "
                            "Please log in again."
                        )
                    },
                    status=status.HTTP_401_UNAUTHORIZED
                )

        except (TokenError, KeyError, TypeError, ValueError):
            return Response(
                {"error": "Invalid or expired refresh token."},
                status=status.HTTP_401_UNAUTHORIZED
            )

        with transaction.atomic():
            user = (
                User.objects
                .select_for_update()
                .filter(pk=user_id, is_active=True)
                .first()
            )

            if not user:
                return Response(
                    {"error": "Invalid user session."},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            profile = (
                FocusHubProfile.objects
                .select_for_update()
                .filter(user=user)
                .first()
            )

            if not profile or token_version != profile.token_version:
                return Response(
                    {
                        "error": (
                            "Your session has expired. "
                            "Please log in again."
                        )
                    },
                    status=status.HTTP_401_UNAUTHORIZED
                )

            active_session = (
                ActiveTabSession.objects
                .select_for_update()
                .filter(user=user)
                .first()
            )

            now = timezone.now()

            if active_session:
                same_tab = active_session.tab_id == tab_id

                stale_tab = (
                    now - active_session.updated_at
                    >= self.ACTIVE_TAB_TIMEOUT
                )

                if not same_tab and not stale_tab and not takeover:
                    return Response(
                        {
                            "active_elsewhere": True,
                            "message": (
                                "Another tab is active. "
                                "Do you want to make this tab active?"
                            )
                        },
                        status=status.HTTP_409_CONFLICT
                    )

                active_session.tab_id = tab_id
                active_session.updated_at = now

                active_session.save(
                    update_fields=["tab_id", "updated_at"]
                )

            else:
                ActiveTabSession.objects.create(
                    user=user,
                    tab_id=tab_id
                )

            # Create a replacement refresh token.
            new_refresh = RefreshToken.for_user(user)
            new_refresh["token_version"] = profile.token_version

            new_access = new_refresh.access_token

            # Blacklist the refresh token used for this successful claim.
            refresh.blacklist()

            return Response(
                {
                    "message": "Active tab session claimed successfully.",
                    "refresh": str(new_refresh),
                    "access": str(new_access),
                    "user": {
                        "id": user.pk,
                        "email": user.email,
                        "full_name": profile.full_name
                    }
                },
                status=status.HTTP_200_OK
            )


class ActiveTabTokenRefreshView(PublicCsrfProtectedAPIView):
    ACTIVE_TAB_TIMEOUT = timedelta(seconds=90)
    def post(self, request):
        refresh_token = request.data.get("refresh")
        tab_id = request.headers.get("X-FocusHub-Tab", "")
        if not isinstance(refresh_token, str) or not refresh_token.strip():
            return Response(
                {"error": "Refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not isinstance(tab_id, str):
            return Response(
                {"error": "A valid tab ID is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        refresh_token = refresh_token.strip()
        tab_id = tab_id.strip()
        if not tab_id or len(tab_id) > 100:
            return Response(
                {"error": "A valid tab ID is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            refresh = RefreshToken(refresh_token)
            refresh.check_blacklist()
            user_id = refresh["user_id"]
            token_version = refresh.get("token_version")
            if token_version is None:
                return Response(
                    {"error": "Invalid session. Please log in again."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            with transaction.atomic():
                user = User.objects.select_for_update().filter(pk=user_id, is_active=True).first()
                if not user:
                    return Response(
                        {"error": "Invalid user session."},
                        status=status.HTTP_401_UNAUTHORIZED
                    )
                profile = FocusHubProfile.objects.select_for_update().filter(user=user).first()
                if not profile or token_version != profile.token_version:
                    return Response(
                        {
                            "error": (
                                "Your session has expired. "
                                "Please log in again."
                            )
                        },
                        status=status.HTTP_401_UNAUTHORIZED
                    )
                active_session = ActiveTabSession.objects.filter(user=user, tab_id=tab_id).first()
                if (not active_session or timezone.now() - active_session.updated_at > self.ACTIVE_TAB_TIMEOUT):
                    return Response(
                        {
                            "error": (
                                "This tab is no longer active. "
                                "Please claim the session again."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN
                    )
                serializer = TokenRefreshSerializer(data={"refresh": refresh_token})
                if not serializer.is_valid():
                    return Response(
                        {"error": "Invalid or expired refresh token."},
                        status=status.HTTP_401_UNAUTHORIZED
                    )
                return Response(
                    serializer.validated_data,
                    status=status.HTTP_200_OK
                )
        except (TokenError, KeyError, TypeError, ValueError):
            return Response(
                {"error": "Invalid or expired refresh token."},
                status=status.HTTP_401_UNAUTHORIZED
            )

class ActiveTabHeartbeatView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        updated = ActiveTabSession.objects.filter(user=request.user, tab_id=request.headers.get("X-FocusHub-Tab", "")).update(updated_at=timezone.now())
        if not updated:
            return Response(
                {"error": "This tab is no longer active. Please log in again."},
                status=status.HTTP_403_FORBIDDEN
            )
        return Response({"message": "Active tab confirmed."}, status=status.HTTP_200_OK)


class LogoutView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        refresh_token = request.data.get("refresh")
        if not isinstance(refresh_token, str) or not refresh_token.strip():
            return Response(
                {"error": "Refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        refresh_token = refresh_token.strip()
        try:
            refresh = RefreshToken(refresh_token)
            refresh.check_blacklist()
            if str(refresh["user_id"]) != str(request.user.id):
                return Response(
                    {"error": "Token does not belong to this user."},
                    status=status.HTTP_403_FORBIDDEN
                )
            access_token = request.auth
            if not access_token:
                return Response(
                    {"error": "Access token is required."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            access_jti = access_token.get("jti")
            access_exp = access_token.get("exp")
            if not access_jti or not access_exp:
                return Response(
                    {"error": "Invalid access token."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            refresh_version = refresh.get("token_version")
            if refresh_version is None:
                return Response(
                    {"error": "Invalid session. Please log in again."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            with transaction.atomic():
                profile = FocusHubProfile.objects.select_for_update().filter(user=request.user).first()
                if not profile:
                    return Response(
                        {"error": "User profile not found."},
                        status=status.HTTP_404_NOT_FOUND
                    )
                if refresh_version != profile.token_version:
                    return Response(
                        {"error": "This session has already been revoked."},
                        status=status.HTTP_401_UNAUTHORIZED
                    )
                profile.token_version += 1
                profile.save(update_fields=["token_version"])
                RevokedAccessToken.objects.get_or_create(
                    jti=access_jti,
                    defaults={"expires_at": timezone.datetime.fromtimestamp(access_exp, tz=timezone.get_current_timezone())}
                )
                outstanding_tokens = OutstandingToken.objects.filter(user=request.user)
                for outstanding in outstanding_tokens:
                    try:
                        RefreshToken(outstanding.token).blacklist()
                    except TokenError:
                        continue
                ActiveTabSession.objects.filter(user=request.user).delete()
            return Response(
                {"message": "Logout successful."},
                status=status.HTTP_200_OK
            )
        except (TokenError, KeyError, TypeError, ValueError):
            return Response(
                {"error": "Invalid or revoked refresh token."},
                status=status.HTTP_401_UNAUTHORIZED
            )


class DeleteAccountView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request):
        password = request.data.get("password", "")
        refresh_token = request.data.get("refresh", "")
        if not isinstance(password, str) or not password:
            return Response(
                {"error": "Current password is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not isinstance(refresh_token, str) or not refresh_token:
            return Response(
                {"error": "Refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        user = request.user
        if not user.check_password(password):
            return Response(
                {"error": "Incorrect password."},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            refresh = RefreshToken(refresh_token)
            refresh.check_blacklist()
            if str(refresh["user_id"]) != str(user.id):
                return Response(
                    {"error": "Invalid account session."},
                    status=status.HTTP_403_FORBIDDEN
                )
            access_token = request.auth
            if not access_token:
                return Response(
                    {"error": "Access token is required."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            access_jti, access_exp = access_token.get("jti"), access_token.get("exp")
            if not access_jti or not access_exp:
                return Response(
                    {"error": "Invalid access token."},
                    status=status.HTTP_401_UNAUTHORIZED
                )
            expires_at = datetime.fromtimestamp(access_exp, tz=timezone.get_current_timezone())
            with transaction.atomic():
                locked_user = User.objects.select_for_update().filter(pk=user.pk).first()
                if not locked_user:
                    return Response(
                        {"error": "Account not found."},
                        status=status.HTTP_404_NOT_FOUND
                    )
                if not locked_user.check_password(password):
                    return Response(
                        {"error": "Incorrect password."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                RevokedAccessToken.objects.get_or_create(jti=access_jti, defaults={"expires_at": expires_at})
                refresh.blacklist()
                OutstandingToken.objects.filter(user=locked_user).delete()
                locked_user.delete()
            return Response(
                {"message": "Your FocusHub account has been permanently deleted."},
                status=status.HTTP_200_OK
            )
        except TokenError:
            return Response(
                {"error": "Invalid or revoked refresh token."},
                status=status.HTTP_401_UNAUTHORIZED
            )


class AccountStatusView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        user = request.user
        security_settings = getattr(user, "security_settings", None)
        return Response({
            "authenticated": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": getattr(getattr(user, "focushubprofile", None), "full_name", ""),
            },
            "card_lock_password_set": bool(security_settings and security_settings.password_hash),
        }, status=status.HTTP_200_OK)

# ---------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------
class NoteListCreateView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        notes = Note.objects.filter(owner=request.user, is_deleted=False, is_archived=False).order_by("-updated_at")
        visible_notes = filter_visible_items(notes, request)
        return Response(
            NoteSerializer(visible_notes, many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        serializer = NoteWriteSerializer(data=request.data)
        if serializer.is_valid():
            note = serializer.save(owner=request.user)
            return Response(
                NoteSerializer(note, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )

class NoteDetailView(AuthenticatedCsrfProtectedAPIView):
    def get_note(self, request, note_id):
        return Note.objects.filter(id=note_id, owner=request.user, is_deleted=False).first()

    def get(self, request, note_id):
        note = self.get_note(request, note_id)
        if not note: return Response({"error": "Note not found."}, status=status.HTTP_404_NOT_FOUND)
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        return Response(
            NoteSerializer(note, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def put(self, request, note_id):
        note = self.get_note(request, note_id)
        if not note: return Response({"error": "Note not found."}, status=status.HTTP_404_NOT_FOUND)
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        serializer = NoteWriteSerializer(note, data=request.data)
        if serializer.is_valid():
            return Response(
                NoteSerializer(serializer.save(owner=request.user), context={"request": request}).data,
                status=status.HTTP_200_OK
            )
        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST
        )

    def delete(self, request, note_id):
        note = self.get_note(request, note_id)
        if not note:
            return Response(
                {"error": "Note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        note.is_deleted = True
        note.save(update_fields=["is_deleted", "updated_at"])
        return Response(
            {"message": "Note moved to deleted."},
            status=status.HTTP_200_OK
        )

class NotePinView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=False).first()
        if not note:
            return Response(
                {"error": "Note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        is_pinned = request.data.get("is_pinned")
        if not isinstance(is_pinned, bool):
            return Response(
                {"error": "is_pinned must be true or false."},
                status=status.HTTP_400_BAD_REQUEST
            )
        note.is_pinned = is_pinned
        note.save(update_fields=["is_pinned", "updated_at"])
        return Response(
            {
                "message": "Note pin status updated successfully.",
                "is_pinned": note.is_pinned,
            },
            status=status.HTTP_200_OK
        )

class NoteArchiveView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=False).first()
        if not note:
            return Response(
                {"error": "Note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        is_archived = request.data.get("is_archived")
        if not isinstance(is_archived, bool):
            return Response(
                {"error": "is_archived must be true or false."},
                status=status.HTTP_400_BAD_REQUEST
            )
        note.is_archived = is_archived
        note.save(update_fields=["is_archived", "updated_at"])
        return Response(
            {
                "message": "Note archive status updated successfully.",
                "is_archived": note.is_archived,
            },
            status=status.HTTP_200_OK
        )


class NoteArchiveListView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        notes = Note.objects.filter(owner=request.user, is_deleted=False, is_archived=True).order_by("-updated_at")
        return Response(
            NoteSerializer(filter_visible_items(notes, request),many=True,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class NoteDeletedListView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        notes = Note.objects.filter(owner=request.user, is_deleted=True).order_by("-updated_at")
        return Response(
            NoteSerializer(filter_visible_items(notes, request),many=True,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class NoteRestoreView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=True).first()
        if not note:
            return Response(
                {"error": "Deleted note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        note.is_deleted = False
        note.save(update_fields=["is_deleted", "updated_at"])
        return Response(
            {
                "message": "Note restored successfully.",
                "is_deleted": note.is_deleted,
            },
            status=status.HTTP_200_OK
        )

class NotePermanentDeleteView(AuthenticatedCsrfProtectedAPIView):
    def delete(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=True).first()
        if not note:
            return Response(
                {"error": "Deleted note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        note.delete()
        return Response(
            {"message": "Note permanently deleted."},
            status=status.HTTP_200_OK
        )


class NoteCopyView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=False).first()
        if not note: return Response({"error": "Note not found."}, status=status.HTTP_404_NOT_FOUND)
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        requested_title = request.data.get("title")
        copy_title = requested_title.strip() if isinstance(requested_title, str) and requested_title.strip() else f"{note.title} (Copy)"
        with transaction.atomic():
            copied_note = Note.objects.create(
                owner=request.user,
                title=copy_title,
                content=note.content,
                is_locked=note.is_locked,
                is_pinned=False,
                is_archived=False,
                is_deleted=False
            )
        return Response(
            {
                "message": "Note copied successfully.",
                "note": NoteSerializer(copied_note, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED
        )


class NoteShareView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, note_id):
        note = Note.objects.filter(id=note_id, owner=request.user, is_deleted=False).first()
        if not note:
            return Response(
                {"error": "Note not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if note.is_locked and not is_unlocked(request): return locked_error("note")
        return Response(
            {
                "message": "Note is ready to share.",
                "type": "note",
                "data": NoteSerializer(note, context={"request": request}).data,
            },
            status=status.HTTP_200_OK
        )

# ---------------------------------------------------------------------
# Lists and list items
# ---------------------------------------------------------------------
class FocusListListCreateView(AuthenticatedCsrfProtectedAPIView):
    def get_list(self, request, list_id):
        return FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()

    def get(self, request, list_id=None):
        if list_id is not None:
            focus_list = self.get_list(request, list_id)
            if not focus_list:
                return Response(
                    {"error": "List not found."},
                    status=status.HTTP_404_NOT_FOUND
                )
            if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
            return Response(
                FocusListSerializer( focus_list, context={"request": request}).data,
                status=status.HTTP_200_OK,
            )
        lists = FocusList.objects.filter(owner=request.user, is_deleted=False, is_archived=False).order_by("-updated_at")
        return Response(
            FocusListSerializer( filter_visible_items(lists, request), many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        serializer = FocusListSerializer(data=request.data)
        if serializer.is_valid():
            focus_list = serializer.save(owner=request.user)
            return Response(
                FocusListSerializer(focus_list,context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def put(self, request, list_id):
        focus_list = self.get_list(request, list_id)
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        serializer = FocusListSerializer(focus_list, data=request.data)
        if serializer.is_valid():
            focus_list = serializer.save(owner=request.user)
            return Response(
                FocusListSerializer(focus_list, context={"request": request}).data,
                status=status.HTTP_200_OK,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, list_id):
        focus_list = self.get_list(request, list_id)
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        focus_list.is_deleted = True
        focus_list.save(update_fields=["is_deleted", "updated_at"])
        return Response({"message": "List moved to deleted."}, status=status.HTTP_200_OK)


class ListItemCreateView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        serializer = ListItemSerializer(data=request.data)
        if serializer.is_valid():
            return Response(ListItemSerializer(serializer.save(focus_list=focus_list)).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ListItemDetailView(AuthenticatedCsrfProtectedAPIView):
    def get_item(self, request, list_id, item_id):
        return ListItem.objects.filter(id=item_id, focus_list_id=list_id, focus_list__owner=request.user, focus_list__is_deleted=False).first()

    def put(self, request, list_id, item_id):
        item = self.get_item(request, list_id, item_id)
        if not item:
            return Response(
                {"error": "List item not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if item.focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        serializer = ListItemSerializer(item, data=request.data)
        if serializer.is_valid():
            return Response(ListItemSerializer(serializer.save()).data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, list_id, item_id):
        item = self.get_item(request, list_id, item_id)
        if not item:
            return Response(
                {"error": "List item not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if item.focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        item.delete()
        return Response({"message": "List item deleted successfully."}, status=status.HTTP_200_OK)


class ListPinView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        is_pinned = request.data.get("is_pinned")
        if not isinstance(is_pinned, bool):
            return Response(
                {"error": "is_pinned must be true or false."},
                status=status.HTTP_400_BAD_REQUEST
            )
        focus_list.is_pinned = is_pinned
        focus_list.save(update_fields=["is_pinned", "updated_at"])
        return Response(
            {
                "message": "List pin status updated successfully.",
                "is_pinned": focus_list.is_pinned,
            },
            status=status.HTTP_200_OK
        )


class ListArchiveView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        is_archived = request.data.get("is_archived")
        if not isinstance(is_archived, bool):
            return Response(
                {"error": "is_archived must be true or false."},
                status=status.HTTP_400_BAD_REQUEST
            )
        focus_list.is_archived = is_archived
        focus_list.save(update_fields=["is_archived", "updated_at"])
        return Response(
            {
                "message": "List archive status updated successfully.",
                "is_archived": focus_list.is_archived,
            },
            status=status.HTTP_200_OK
        )


class ListArchiveListItemView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        lists = FocusList.objects.filter(owner=request.user, is_deleted=False, is_archived=True).order_by("-updated_at")
        return Response(
            FocusListSerializer(filter_visible_items(lists, request),many=True,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class ListDeletedListView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        lists = FocusList.objects.filter(owner=request.user, is_deleted=True).order_by("-updated_at")
        return Response(
            FocusListSerializer(filter_visible_items(lists, request),many=True,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class ListRestoreView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=True).first()
        if not focus_list:
            return Response(
                {"error": "Deleted list not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        focus_list.is_deleted = False
        focus_list.save(update_fields=["is_deleted", "updated_at"])
        return Response(
            {
                "message": "List restored successfully.",
                "is_deleted": focus_list.is_deleted,
            },
            status=status.HTTP_200_OK
        )


class ListPermanentDeleteView(AuthenticatedCsrfProtectedAPIView):
    def delete(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=True).first()
        if not focus_list:
            return Response(
                {"error": "Deleted list not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        focus_list.delete()
        return Response(
            {"message": "List permanently deleted."},
            status=status.HTTP_200_OK
        )


class ListCopyView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        requested_title = request.data.get("title")
        copy_title = requested_title.strip() if isinstance(requested_title, str) and requested_title.strip() else f"{focus_list.title} copy"

        with transaction.atomic():
            copied_list = FocusList.objects.create(owner=request.user, title=copy_title, is_locked=focus_list.is_locked, is_pinned=False, is_archived=False, is_deleted=False)
            ListItem.objects.bulk_create([ListItem(focus_list=copied_list, text=item.text, is_completed=item.is_completed) for item in focus_list.items.all()])

        return Response(
            {
                "message": "List copied successfully.",
                "list": FocusListSerializer(copied_list, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED
        )


class ListShareView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, list_id):
        focus_list = FocusList.objects.filter(id=list_id, owner=request.user, is_deleted=False).first()
        if not focus_list:
            return Response(
                {"error": "List not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        if focus_list.is_locked and not is_unlocked(request): return locked_error("list")
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        share_url = f"{frontend_url}/shared/lists/{focus_list.id}/"
        return Response(
            {
                "message": "List is ready to share.",
                "type": "list",
                "url": share_url,
                "data": FocusListSerializer(focus_list, context={"request": request}).data,
            },
            status=status.HTTP_200_OK
        )

# ---------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------
class TaskListCreateView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        tasks = Task.objects.filter(owner=request.user, is_deleted=False, is_archived=False).order_by("-updated_at")
        tasks = filter_visible_items(tasks, request)
        return Response(
            TaskSerializer(tasks,many=True,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )
    def post(self, request):
        serializer = TaskSerializer(data=request.data,context={"request": request},)
        if serializer.is_valid():
            task = serializer.save(owner=request.user)
            return Response(
                TaskSerializer(task,context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )


class TaskDetailView(AuthenticatedCsrfProtectedAPIView):
    def get_task(self, request, task_id):
        return Task.objects.filter(id=task_id, owner=request.user, is_deleted=False).first()
    def get(self, request, task_id):
        task = self.get_task(request, task_id)
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        return Response(
            TaskSerializer(task, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )
    def put(self, request, task_id):
        task = self.get_task(request, task_id)
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        serializer = TaskSerializer(task, data=request.data, context={"request": request})
        if serializer.is_valid():
            return Response(
                TaskSerializer(serializer.save(owner=request.user), context={"request": request}).data,
                status=status.HTTP_200_OK,
            )
        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )
    def delete(self, request, task_id):
        task = self.get_task(request, task_id)
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        task.is_deleted = True
        task.save(update_fields=["is_deleted", "updated_at"])
        return Response(
            {"message": "Task moved to deleted."},
            status=status.HTTP_200_OK,
        )


class TaskPinView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, task_id):
        task = Task.objects.filter(id=task_id, owner=request.user, is_deleted=False).first()
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        if "is_pinned" not in request.data:
            return Response(
                {"error": "is_pinned is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        is_pinned = request.data.get("is_pinned")
        if not isinstance(is_pinned, bool):
            return Response(
                {"error": "is_pinned must be a boolean."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task.is_pinned = is_pinned
        task.save(update_fields=["is_pinned", "updated_at"])
        return Response(
            TaskSerializer(task, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class TaskArchiveView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, task_id):
        task = Task.objects.filter(id=task_id, owner=request.user, is_deleted=False).first()
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        if "is_archived" not in request.data:
            return Response(
                {"error": "is_archived is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        is_archived = request.data.get("is_archived")
        if not isinstance(is_archived, bool):
            return Response(
                {"error": "is_archived must be a boolean."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task.is_archived = is_archived
        task.save(update_fields=["is_archived", "updated_at"])
        return Response(
            TaskSerializer(task, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class TaskArchiveListView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        tasks = Task.objects.filter(owner=request.user, is_deleted=False, is_archived=True).order_by("-updated_at")
        tasks = filter_visible_items(tasks, request)
        return Response(
            TaskSerializer(tasks, many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class TaskDeletedListView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request):
        tasks = Task.objects.filter(owner=request.user, is_deleted=True).order_by("-updated_at")
        tasks = filter_visible_items(tasks, request)
        return Response(
            TaskSerializer(tasks, many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class TaskRestoreView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, task_id):
        task = Task.objects.filter(id=task_id,owner=request.user,is_deleted=True).first()
        if not task:
            return Response(
                {"error": "Deleted task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        task.is_deleted = False
        task.save(update_fields=["is_deleted", "updated_at"])
        return Response(
            {
                "message": "Task restored successfully.",
                "task": TaskSerializer(task,context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )


class TaskPermanentDeleteView(AuthenticatedCsrfProtectedAPIView):
    def delete(self, request, task_id):
        task = Task.objects.filter(id=task_id,owner=request.user,is_deleted=True).first()
        if not task:
            return Response(
                {"error": "Deleted task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        task.delete()
        return Response(
            {"message": "Task permanently deleted."},
            status=status.HTTP_200_OK,
        )


class TaskCopyView(AuthenticatedCsrfProtectedAPIView):
    def post(self, request, task_id):
        task = Task.objects.filter(id=task_id,owner=request.user,is_deleted=False).first()
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        requested_title = request.data.get("title")
        copy_title = (
            requested_title.strip()
            if isinstance(requested_title, str) and requested_title.strip()
            else f"{task.title} copy"
        )
        with transaction.atomic():
            copied_task = Task.objects.create(
                owner=request.user,
                title=copy_title,
                description=task.description,
                assigned_to=task.assigned_to,
                priority=task.priority,
                status=task.status,
                due_date=task.due_date,
                is_locked=task.is_locked,
                is_pinned=False,
                is_archived=False,
                is_deleted=False,
            )
        return Response(
            TaskSerializer(copied_task,context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TaskShareView(AuthenticatedCsrfProtectedAPIView):
    def get(self, request, task_id):
        task = Task.objects.filter(id=task_id, owner=request.user, is_deleted=False).first()
        if not task:
            return Response(
                {"error": "Task not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.is_locked and not is_unlocked(request):
            return locked_error("task")
        return Response(
            TaskSerializer(task,context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, task_id):
        return self.get(request, task_id)