from django.conf import settings
from django.db import models
from django.core.validators import MinLengthValidator

# ---------------------------------------------------------
# Security
# ---------------------------------------------------------
class SecuritySettings(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL,on_delete=models.CASCADE,related_name="security_settings",null=True,blank=True)
    email = models.EmailField(unique=True)
    password_hash = models.CharField(max_length=255)
    otp_attempts = models.PositiveSmallIntegerField(default=0)
    otp_resend_count = models.PositiveSmallIntegerField(default=0)
    otp_last_sent_at = models.DateTimeField(null=True, blank=True)
    otp_hash = models.CharField(max_length=255, blank=True, default="")
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.email

    class Meta:
        verbose_name = "Security Setting"
        verbose_name_plural = "Security Settings"

class FocusHubProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focushub_profile")
    full_name = models.CharField(max_length=150)
    date_of_birth = models.DateField()
    mobile_number = models.CharField(max_length=20)
    token_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.full_name


class PasswordResetOTP(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_reset_otp")
    otp_hash = models.CharField(max_length=255, blank=True, default="")
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    otp_attempts = models.PositiveSmallIntegerField(default=0)
    otp_resend_count = models.PositiveSmallIntegerField(default=0)
    otp_last_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Password reset OTP for {self.user.email}"


class ActiveTabSession(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="active_tab_session")
    tab_id = models.CharField(max_length=100)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self): return f"{self.user.email} - active tab"


class RevokedAccessToken(models.Model):
    jti = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Revoked access token: {self.jti}"


class PendingRegistration(models.Model):
    email = models.EmailField(unique=True)
    email_verified = models.BooleanField(default=False)
    full_name = models.CharField(max_length=150, blank=True, default="")
    password_hash = models.CharField(max_length=255, blank=True, default="")
    date_of_birth = models.DateField(null=True, blank=True)
    mobile_number = models.CharField(max_length=20, blank=True, default="")

    otp_hash = models.CharField(max_length=255, blank=True, default="")
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    otp_attempts = models.PositiveSmallIntegerField(default=0)
    otp_resend_count = models.PositiveSmallIntegerField(default=0)
    otp_last_sent_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Pending registration for {self.email}"

    class Meta:
        verbose_name = "Pending Registration"
        verbose_name_plural = "Pending Registrations"

# ---------------------------------------------------------
# Notes
# ---------------------------------------------------------
class Note(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notes")
    title = models.CharField(max_length=200, validators=[MinLengthValidator(1)])
    content = models.TextField(blank=True, default="")
    is_locked = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Note"
        verbose_name_plural = "Notes"
# ---------------------------------------------------------
# Lists
# ---------------------------------------------------------
class FocusList(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focus_lists")
    title = models.CharField(max_length=200, validators=[MinLengthValidator(1)])
    is_locked = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Focus List"
        verbose_name_plural = "Focus Lists"


class ListItem(models.Model):
    focus_list = models.ForeignKey(FocusList, on_delete=models.CASCADE, related_name="items")
    text = models.CharField(max_length=300, validators=[MinLengthValidator(1)])
    is_completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.text

    class Meta:
        ordering = ["created_at"]
        verbose_name = "List Item"
        verbose_name_plural = "List Items"


# ---------------------------------------------------------
# Tasks
# ---------------------------------------------------------
class Task(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks")
    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("in_progress", "In Progress"),
        ("completed", "Completed"),
    ]

    title = models.CharField(max_length=200, validators=[MinLengthValidator(1)])
    description = models.TextField(blank=True, default="")
    assigned_to = models.CharField(max_length=150, blank=True, default="")
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    due_date = models.DateField(null=True, blank=True)
    is_locked = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Task"
        verbose_name_plural = "Tasks"