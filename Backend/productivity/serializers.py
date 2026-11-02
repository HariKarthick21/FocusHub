from rest_framework import serializers
from .models import Note, FocusList, ListItem, Task

def is_request_unlocked(request):
    if not request or not request.user or not request.user.is_authenticated:
        return False
    unlocked_user_id = request.session.get("focushub_unlocked_user_id")
    return unlocked_user_id == request.user.pk


# ---------------------------------------------------------
# Notes
# ---------------------------------------------------------
class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ["id", "title", "content", "is_locked", "is_pinned", "is_archived", "is_deleted", "created_at", "updated_at"]
        read_only_fields = ["id", "is_pinned", "is_archived", "is_deleted", "created_at", "updated_at"]
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request is None:
            request = getattr(self, "_request", None)
        if instance.is_locked and not (request and is_request_unlocked(request)):
            data["title"] = "Private Note"
            data["content"] = []
        return data

class NoteWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ["title", "content", "is_locked"]


# ---------------------------------------------------------
# Lists
# ---------------------------------------------------------
class ListItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListItem
        fields = ["id", "focus_list", "text", "is_completed", "created_at", "updated_at"]
        read_only_fields = ["id", "focus_list", "created_at", "updated_at"]

class FocusListSerializer(serializers.ModelSerializer):
    items = ListItemSerializer(many=True, read_only=True)
    class Meta:
        model = FocusList
        fields = ["id", "title", "is_locked", "is_pinned", "is_archived", "is_deleted", "items", "created_at", "updated_at"]
        read_only_fields = ["id", "items", "is_pinned", "is_archived", "is_deleted", "created_at", "updated_at"]
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request") or getattr(self, "_request", None)
        if instance.is_locked and not (request and is_request_unlocked(request)):
            locked_lists = FocusList.objects.filter(owner=instance.owner, is_locked=True).order_by("created_at", "id")
            index = next((pos for pos, l_list in enumerate(locked_lists, start=1) if l_list.id == instance.id), 1)
            data["title"] = f"Private Lists ({index})"
            data["items"] = []
        return data


# ---------------------------------------------------------
# Tasks
# ---------------------------------------------------------
class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title", "description", "assigned_to", "priority", "status", "due_date", "is_locked", "is_pinned", "is_archived", "is_deleted", "created_at", "updated_at"]
        read_only_fields = ["id", "is_pinned", "is_archived", "is_deleted", "created_at", "updated_at"]
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request is None:
            request = getattr(self, "_request", None)
        if instance.is_locked and not (request and is_request_unlocked(request)):
            data["title"] = "Private Task"
            data["description"] = ""
        return data