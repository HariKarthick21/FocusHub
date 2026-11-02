from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from .models import RevokedAccessToken, FocusHubProfile


class RevocableJWTAuthentication(JWTAuthentication):
    def get_validated_token(self, raw_token):
        validated_token = super().get_validated_token(raw_token)
        token_jti = validated_token.get("jti")
        if (token_jti and RevokedAccessToken.objects.filter(jti=token_jti).exists()):
            raise AuthenticationFailed(
                "This access token has been revoked. Please log in again.",
                code="token_revoked"
            )
        user_id = validated_token.get("user_id")
        token_version = validated_token.get("token_version")
        if user_id is None or token_version is None:
            raise AuthenticationFailed(
                "Invalid session. Please log in again.",
                code="invalid_session"
            )
        profile = FocusHubProfile.objects.filter(user_id=user_id).only("token_version").first()
        if not profile:
            raise AuthenticationFailed(
                "User profile not found. Please log in again.",
                code="profile_not_found"
            )
        if token_version != profile.token_version:
            raise AuthenticationFailed(
                "Your session has expired. Please log in again.",
                code="session_revoked"
            )
        return validated_token