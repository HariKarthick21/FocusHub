import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getTasks, createTask, updateTask, deleteTask, archiveTask, copyTask, shareTask, getArchivedTasks, toggleTaskPin ,verifyCardLockPassword } from "../services/taskService";
import { getAccountStatus } from "../services/accountService";
import Loader from "../components/Loader";
import CustomCalendar from "../components/CustomCalendar";
import "../index.css";

const EMPTY_TASK = { title: "", description: "", assigned_to: "", priority: "", status: "", due_date: "", is_locked: false };

function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Tasks() {
  const popupTimeoutRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const [tasks, setTasks] = useState([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);

  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);

  const [taskForm, setTaskForm] = useState({ ...EMPTY_TASK });
  const [taskErrors, setTaskErrors] = useState({});

  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("grid");
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [actionTaskId, setActionTaskId] = useState(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const [cardLockPasswordSet, setCardLockPasswordSet] = useState(false);
  const [showUnlockPrompt, setshowUnlockPrompt] = useState(false);
  const [showSecurePrompt, setShowSecurePrompt] = useState(false);

  const [securePassword, setSecurePassword] = useState("");
  const [showSecurePassword, setShowSecurePassword] = useState(false);
  const [securePasswordError, setSecurePasswordError] = useState("");
  const [isVerifyingPassword, setisVerifyingPassword] = useState(false);

  const [unlockedTaskIds, setUnlockedTaskIds] = useState([]);
  const [secureAction, setSecureAction] = useState("");
  const [secureActionTaskIds, setSecureActionTaskIds] = useState([]);


  // ========== Popup Tasks ==========
  const [popup, setPopup] = useState({ show: false, type: "", message: ""});
  const showPopup = useCallback((type, message) => {
    if (popupTimeoutRef.current) {
      clearTimeout(popupTimeoutRef.current);
    }
    setPopup({ show: true, type, message });
    popupTimeoutRef.current = setTimeout(() => {
      setPopup({ show: false, type: "", message: "" });
      popupTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => { if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current); };
  }, []);

  // ========== Fetch Tasks ==========
  const fetchTasks = useCallback(async () => {
    setIsLoadingTasks(true);
    setLoadError("");
    try {
      const result = await getTasks();
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || result?.data?.message || "Unable to load tasks. Please try again.");
      }
      const fetchedTasks = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.results) ? result.data.results : Array.isArray(result.data?.data) ? result.data.data : null;
      if (!fetchedTasks) throw new Error("The server returned an unexpected response.");
      setTasks(fetchedTasks);
      const validIds = new Set(fetchedTasks.map((task) => String(task.id)));
      setSelectedTaskIds((current) => current.filter((id) => validIds.has(String(id))));
      return fetchedTasks;
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setLoadError(error.message || "Unable to connect to FocusHub. Check your connection and try again.");
      return [];
    } finally {
      setIsLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ========== Tasks Directs to Accounts page ==========
  useEffect(() => {
    let isMounted = true;
    const checkCardLockPassword = async () => {
      try {
        const result = await getAccountStatus();
        if (isMounted && result?.status === 200) {
          setCardLockPasswordSet(Boolean(result.data?.card_lock_password_set));
        }
      } catch (error) {
        console.error("Unable to check Card Lock Password status:", error);
      }
    };
    checkCardLockPassword();
    return () => {isMounted = false};
  }, []);

  // ========== Sorting Tasks ==========
  const sortedTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.is_archived && !task.is_deleted)
      .sort((a, b) => {
        if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
        if (sortBy === "title-asc") return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
        if (sortBy === "title-desc") return (b.title || "").localeCompare(a.title || "", undefined, { sensitivity: "base" });
        const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
        const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
        return sortBy === "oldest" ? dateA - dateB : dateB - dateA;
      });
  }, [tasks, sortBy]);

  // ========== Selecting Tasks ==========
  const isTaskSelected = (taskId) => selectedTaskIds.some((id) => String(id) === String(taskId));
  const getSelectedTasks = () => {
    if (selectedTaskIds.length === 0) {
      showPopup("error", "Select at least one task first.");
      return [];
    }
    return sortedTasks.filter((task) => isTaskSelected(task.id));
  };
  const toggleTaskSelection = (event, taskId) => {
    event.stopPropagation();
    setSelectedTaskIds((current) => current.some((selid) => String(selid) === String(taskId)) ? current.filter((selid) => String(selid) !== String(taskId)) : [...current, taskId]);
  };
  const allTasksSelected = sortedTasks.length > 0 &&sortedTasks.every((task) => isTaskSelected(task.id));
  const handleToggleSelectAll = () => {
    setSelectedTaskIds((current) => {
      const allSelected = sortedTasks.length > 0 && sortedTasks.every((task) => current.some((id) => String(id) === String(task.id)));
      return allSelected ? [] : sortedTasks.map((task) => task.id);
    });
  };

  // ========== Pin / Unpin Tasks ==========
  const pinnedTasks = sortedTasks.filter((task) => task.is_pinned);
  const unpinnedTasks = sortedTasks.filter((task) => !task.is_pinned);
  const handleTogglePin = async (event, task) => {
    event.stopPropagation();
    if (isProcessingAction) return;
    const newPinnedStatus = !task.is_pinned;
    setIsProcessingAction(true);
    setActionTaskId(task.id);
    try {
      const result = await toggleTaskPin(task.id, newPinnedStatus);
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || "Unable to update task pin.");
      }
      await fetchTasks();
      showPopup("success", newPinnedStatus ? "Task pinned." : "Task unpinned.");
    } catch (error) {
      console.error("Error updating task pin:", error);
      showPopup("error", error.message || "Unable to update task pin.");
    } finally {
      setIsProcessingAction(false);
      setActionTaskId(null);
    }
  };

  // ========== Archive Selected Tasks ==========
  const handleArchiveSelected = async () => {
    const selectedTasks = getSelectedTasks();
    if (!selectedTasks.length || isProcessingAction) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const results = await Promise.allSettled(selectedTasks.map((task) => archiveTask(task.id, true)));
      const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
      await fetchTasks();
      setSelectedTaskIds([]);
      if (failedCount === 0) {
        showPopup("success", "Selected tasks archived successfully.");
      } else {
        showPopup("error", `${failedCount} task(s) could not be archived.`);
      }
    } catch (error) {
      console.error("Error archiving tasks:", error);
      showPopup("error", "Unable to archive the selected tasks.");
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ========== Share Selected Tasks ==========
  const sendSelectedTasks = async (selectedTasks) => {
    if (!selectedTasks.length || isProcessingAction) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const sharedTasks = [];
      for (const task of selectedTasks) {
        const result = await shareTask(task.id);
        if (!result || result.status < 200 || result.status >= 300) {
          throw new Error(result?.data?.detail || result?.data?.error || `Unable to prepare "${task.title || "Untitled task"}" for sharing.`);
        }
        const sharedTask = result.data?.data ?? result.data;
        if (!sharedTask) throw new Error("Unable to prepare the selected tasks.");
        sharedTasks.push({ ...sharedTask, title: task.is_locked ? getPrivateTaskTitle(task) : sharedTask.title || "Untitled task" });
      }

      const shareText = sharedTasks.map((task) => {
        const lines = [task.title, task.description || "No description", `Priority: ${task.priority || "medium"}`, `Status: ${(task.status || "pending").replace(/_/g, " ")}`];
        const assignedTo = typeof task.assigned_to === "object" ? task.assigned_to?.username : task.assigned_to;
        if (assignedTo) lines.push(`Assigned to: ${assignedTo}`);
        if (task.due_date) lines.push(`Due date: ${task.due_date}`);
        return lines.join("\n");
      }).join("\n\n--------------------\n\n");
      if (navigator.share) {
        await navigator.share({ title: "FocusHub Tasks", text: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        showPopup("success", "Selected tasks copied. You can paste them into a sharing app.");
      } else {
        showPopup("error", "Sharing is unavailable in this browser.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("Error sharing tasks:", error);
        showPopup("error", error.message || "Unable to share selected tasks.");
      }
    } finally {
      setIsProcessingAction(false);
    }
  };
  const handleSendSelected = async () => {
    const selectedTasks = getSelectedTasks();
    if (!selectedTasks.length || isProcessingAction) return;
    if (selectedTasks.some((task) => task.is_locked)) {
      setSecureAction("send");
      setSecureActionTaskIds(selectedTasks.map((t) => t.id));
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setShowMoreMenu(false);
      return setshowUnlockPrompt(true);
    }
    await sendSelectedTasks(selectedTasks);
  };

  // ========== Copy Selected Tasks ==========
  const copySelectedTasks = async (selectedTasks) => {
    if (!selectedTasks.length || isProcessingAction) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const latestResult = await getTasks();
      if (!latestResult || latestResult.status < 200 || latestResult.status >= 300) throw new Error("Unable to check existing task titles.");
      const latestData = latestResult.data;
      const latestTasks = Array.isArray(latestData) ? latestData : Array.isArray(latestData?.results) ? latestData.results : Array.isArray(latestData?.data) ? latestData.data : [];
      const existingTitles = new Set(latestTasks.map((t) => String(t.title || "").trim().toLocaleLowerCase()));
      let failedCount = 0;
      for (const task of selectedTasks) {
        const displayTitle = task.is_locked ? getPrivateTaskTitle(task) : String(task.title || "Untitled task").trim();
        const baseTitle = displayTitle.replace(/ copy(?: \(\d+\))?$/i, "").trim() || "Untitled task";
        let copyTitle = `${baseTitle} copy`, copyNumber = 1;
        while (existingTitles.has(copyTitle.toLocaleLowerCase())) {
          copyTitle = `${baseTitle} copy (${copyNumber})`;
          copyNumber++;
        }
        existingTitles.add(copyTitle.toLocaleLowerCase());
        try {
          const result = await copyTask(task.id, copyTitle);
          if (!result || result.status < 200 || result.status >= 300) failedCount++;
        } catch (error) {
          console.error("Unable to copy task:", task.id, error);
          failedCount++;
        }
      }
      await fetchTasks();
      setSelectedTaskIds([]);
      showPopup(failedCount === 0 ? "success" : "error", failedCount === 0 ? "Selected tasks copied successfully." : `${failedCount} task(s) could not be copied.`);
    } catch (error) {
      console.error("Error copying tasks:", error);
      showPopup("error", error.message || "Unable to copy selected tasks.");
    } finally {
      setIsProcessingAction(false);
    }
  };
  const handleCopySelected = async () => {
    const selectedTasks = getSelectedTasks();
    if (!selectedTasks.length || isProcessingAction) return;
    if (selectedTasks.some((task) => task.is_locked)) {
      setSecureAction("copy");
      setSecureActionTaskIds(selectedTasks.map((t) => t.id));
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setShowMoreMenu(false);
      return setshowUnlockPrompt(true);
    }
    await copySelectedTasks(selectedTasks);
  };

  // ========== Bulk Delete Tasks ==========
  const confirmBulkDelete = async () => {
    if (selectedTaskIds.length === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    try {
      const idsToDelete = [...selectedTaskIds];
      const results = await Promise.allSettled(idsToDelete.map((id) => deleteTask(id)));
      const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
      await fetchTasks();
      setShowBulkDeleteConfirm(false);
      setSelectedTaskIds([]);
      if (failedCount === 0) {
        showPopup("success", "Selected tasks moved to Trash.");
      } else {
        showPopup("error", `${failedCount} task(s) could not be moved to Trash.`);
      }
    } catch (error) {
      console.error("Error moving tasks to Trash:", error);
      showPopup("error", "Unable to move tasks to Trash.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ========== More actions for Task ==========
  useEffect(() => {
      if (selectedTaskIds.length === 0) {
          setShowMoreMenu(false);
      }
  }, [selectedTaskIds]);

  // ========== Create, View, Edit a Task ==========
  const handleCreateNewTask = () => {
    setSelectedTask(null);
    setTaskForm({ ...EMPTY_TASK });
    setTaskErrors({});
    setIsEditingTask(true);
    setShowTaskForm(true);
  };

  const handleViewTask = (task) => {
    setSelectedTask(task);
    setTaskForm({
      title: task.title || "",
      description: task.description || "",
      assigned_to:
        typeof task.assigned_to === "object"
          ? task.assigned_to?.username || ""
          : task.assigned_to || "",
      priority: task.priority || "",
      status: task.status || "",
      due_date: task.due_date || "",
      is_locked: Boolean(task.is_locked),
    });
    setTaskErrors({});
    setIsEditingTask(false);
    setShowTaskForm(true);
  };

  const handleOpenTask = (task) => {
    if (task.is_locked) {
      setSelectedTask(task);
      setSecureAction("");
      setSecureActionTaskIds([task.id]);
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setshowUnlockPrompt(true);
      return;
    }
    handleViewTask(task);
  };

  const handleEditTask = () => {
    if (!selectedTask || isSavingTask) return;
    setIsEditingTask(true);
    setTaskErrors({});
  };

  const handleTaskFormChange = (event) => {
    const { name, value } = event.target;
    setTaskForm((current) => ({ ...current, [name]: value }));
    setTaskErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleQuickUpdate = async (field, value) => {
    if (!selectedTask || isSavingTask) return;
    const previousTask = selectedTask;
    const updatedTask = { ...previousTask, ...taskForm, [field]: value };
    setTaskForm((current) => ({ ...current, [field]: value }));
    setIsSavingTask(true);
    try {
      const response = await updateTask(previousTask.id, {
        title: updatedTask.title || "",
        description: updatedTask.description || "",
        assigned_to: updatedTask.assigned_to || "",
        priority: updatedTask.priority || "medium",
        status: updatedTask.status || "pending",
        due_date: updatedTask.due_date || null,
        is_locked: Boolean(updatedTask.is_locked),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(response.data?.detail || response.data?.error || response.data?.message || `Unable to update ${field}.`);
      }
      const savedTask = response.data && typeof response.data === "object" ? response.data : updatedTask;
      const finalTask = { ...updatedTask, ...savedTask };
      setSelectedTask(finalTask);
      setTasks((currentTasks) => currentTasks.map((task) => String(task.id) === String(previousTask.id) ? finalTask : task));
      setTaskForm((current) => ({ ...current, priority: finalTask.priority || "medium", status: finalTask.status || "pending" }));
      showPopup("success", `${field === "priority" ? "Priority" : "Status"} updated.`);
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      setSelectedTask(previousTask);
      setTaskForm((current) => ({ ...current, [field]: previousTask[field] || "" }));
      showPopup("error", error.message || `Unable to update ${field}.`);
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleClearTaskForm = () => {
    if (isSavingTask) return;
    setTaskForm({ ...EMPTY_TASK });
    setTaskErrors({});
  };

  const handleCloseTaskForm = () => {
    if (isSavingTask) return;
    setSelectedTask(null);
    setTaskForm({ ...EMPTY_TASK });
    setTaskErrors({});
    setIsEditingTask(false);
    setShowTaskForm(false);
  };

  // ========== Create, Update, Save a Task ==========
  const handleSaveTask = async (event) => {
    event.preventDefault();
    if (isSavingTask || !isEditingTask) return;
    const today = getTodayDate();
    const dueDateChanged = taskForm.due_date !== selectedTask?.due_date || "";
    const nextErrors = {
      title: taskForm.title.trim() ? "" : "Task title is required.",
      description: taskForm.description.trim() ? "" : "Description is required.",
      assigned_to: taskForm.assigned_to.trim() ? "" : "Assigned to is required.",
      priority: taskForm.priority ? "" : "Please select a priority.",
      status: taskForm.status ? "" : "Please select a status.",
      due_date: taskForm.due_date ? "" : "Due date is required.",
    };
    if (taskForm.due_date && taskForm.due_date < today && dueDateChanged) {
      nextErrors.due_date = "Due date must be today or a future date.";
    }
    setTaskErrors(nextErrors);
    if (Object.values(nextErrors).some((error) => error !== "")) {
      showPopup("error", "Please correct the highlighted fields.");
      return;
    }
    setIsSavingTask(true);
    const payload = {
      ...taskForm,
      title: taskForm.title.trim(),
      description: taskForm.description.trim(),
      assigned_to: taskForm.assigned_to.trim(),
      due_date: taskForm.due_date || null,
      is_locked: Boolean(taskForm.is_locked),
    };
    try {
      const result = selectedTask ? await updateTask(selectedTask.id, payload) : await createTask(payload);
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || result?.data?.message || `Unable to ${selectedTask ? "update" : "create"} task.`);
      }
      await fetchTasks();
      showPopup("success", selectedTask ? "Task updated successfully." : "Task created successfully.");
      setSelectedTask(null);
      setTaskForm({ ...EMPTY_TASK });
      setTaskErrors({});
      setIsEditingTask(false);
      setShowTaskForm(false);
    } catch (error) {
      console.error("Error saving task:", error);
      showPopup("error", error.message || "Unable to save the task.");
    } finally {
      setIsSavingTask(false);
    }
  };

  // ========== Verify Card Lock Password ==========
  const handleVerifySecurePassword = async (event) => {
    event.preventDefault();
    if (isVerifyingPassword || !securePassword.trim()) return;
    setisVerifyingPassword(true);
    setSecurePasswordError("");
    try {
      const result = await verifyCardLockPassword(securePassword);
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || result?.data?.message || "Incorrect Card Lock Password.");
      }
      const action = secureAction;
      const taskIds = [...secureActionTaskIds];
      setUnlockedTaskIds((current) => [
        ...new Set([...current.map(String), ...taskIds.map(String)]),
      ]);
      const selectedTasks = sortedTasks.filter((task) =>
        taskIds.some((id) => String(id) === String(task.id))
      );
      setshowUnlockPrompt(false);
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setSecureAction("");
      setSecureActionTaskIds([]);
      if (action === "copy") {
        await copySelectedTasks(selectedTasks);
        return;
      }
      if (action === "send") {
        await sendSelectedTasks(selectedTasks);
        return;
      }
      if (selectedTask) {
        const response = await getTasks();
        if (response?.status >= 200 && response.status < 300) {
          const data = response.data;
          const latestTasks = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : [];
          const latestTask = latestTasks.find(
            (task) => String(task.id) === String(selectedTask.id)
          );
          if (latestTask) {
            handleViewTask(latestTask);
          }
        }
      }
      showPopup("success", "Task unlocked successfully.");
    } catch (error) {
      console.error("Error verifying Card Lock Password:", error);
      setSecurePasswordError(error.message || "Unable to verify Card Lock Password.");
    } finally {
      setisVerifyingPassword(false);
    }
  };

  // ========== Open Task from Navigation ==========
  useEffect(() => {
    const state = location.state || {};
    const requestedTaskId = state.editTaskId ?? state.taskId;
    const shouldEdit = Boolean(state.openForEdit || state.editTaskId != null);
    const shouldOpenView = Boolean(state.openTaskView);
    const fromArchive = Boolean(state.fromArchive);
    if (requestedTaskId == null || isLoadingTasks || loadError) return;
    let cancelled = false;
    const openSelectedTask = async () => {
      let task = tasks.find((item) => String(item.id) === String(requestedTaskId));
      if (!task && fromArchive) {
        try {
          const response = await getArchivedTasks();
          if (cancelled) return;
          if (response?.status >= 200 && response.status < 300) {
            const resData = response.data;
            const archivedTasks = Array.isArray(resData) ? resData : Array.isArray(resData?.results) ? resData.results : Array.isArray(resData?.data) ? resData.data : [];
            task = archivedTasks.find((item) => String(item.id) === String(requestedTaskId));
          }
        } catch (error) {
          console.error("Error loading archived task:", error);
        }
      }
      if (cancelled) return;
      navigate(location.pathname, { replace: true, state: null });
      if (!task) {
        showPopup("error", "Unable to find the selected task.");
        return;
      }
      if (task.is_locked) {
        showPopup("error", "This task is secured. Unlock it before editing.");
        return;
      }
      handleViewTask(task);
      if (shouldEdit) {
        setIsEditingTask(true);
      } else if (shouldOpenView) {
        setIsEditingTask(false);
      }
    };
    openSelectedTask();
    return () => { cancelled = true; };
  }, [location.state, location.pathname, tasks, isLoadingTasks, loadError, navigate, showPopup]);

  // ========== Date Formatting ==========
  const formatDate = (dateValue) => {
    if (!dateValue) return "";
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateValue;
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  const isOverdue = (task) => {
    if (!task.due_date || task.status === "completed") return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(`${task.due_date}T00:00:00`);
    return !Number.isNaN(dueDate.getTime()) && dueDate < today;
  };

  // ========== Handling Task Security ==========
  const handleToggleTaskLock = () => {
    if (taskForm.is_locked) {
      setTaskForm((current) => ({...current, is_locked: false}));
      return;
    }
    if (!cardLockPasswordSet) {
      setShowSecurePrompt(true);
      return;
    }
    setTaskForm((current) => ({...current, is_locked: true}));
  };

  // ========== Secure Task Card Title ==========
  const getPrivateTaskTitle = (task) => {
    const lockedTasks = tasks.filter((item) => item.is_locked).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB || Number(a.id) - Number(b.id);
      });
    const actualTitle = String(task.title || "").trim();
    const safeCopyMatch = actualTitle.match(/^Private Tasks \((\d+)\)( copy(?: \(\d+\))?)$/i);
    if (safeCopyMatch) return `Private Tasks (${safeCopyMatch[1]})${safeCopyMatch[2]}`;
    const index = lockedTasks.findIndex((item) => String(item.id) === String(task.id));
    return `Private Tasks (${index >= 0 ? index + 1 : 1})`;
  };

  // ========== Render Task Card ==========
  const renderTaskCard = (task) => {
    const selected = isTaskSelected(task.id);
    const assignee = typeof task.assigned_to === "object" ? task.assigned_to?.username || "Unassigned" : task.assigned_to || "Unassigned";
    const priority = (task.priority || "medium").toLowerCase();
    const status = (task.status || "pending").toLowerCase().replace(/\s+/g, "_");
    return viewMode === "list" ? (
      // list view
      <article className={`task-card task-card-list ${task.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={task.id}  onClick={() => handleOpenTask(task)}>
        <div className="task-list-left">
          {/* Metadata & Selection Controls */}
          <div className="task-list-top">
            <label className="select-label" onClick={(event) => event.stopPropagation()} title="Select task">
              <input type="checkbox" className="select-checkbox" checked={selected} onChange={(event) => toggleTaskSelection(event, task.id)} aria-label={`Select ${task.title || "task"}`} />
              <span className="select-checkmark" />
            </label>
            <div className="task-card-meta">
              <span className={`task-priority priority-${priority}`}>
                <i className="fa-solid fa-flag" /> {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </span>
              <span className={`task-status status-${status}`}>
                {status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())}
              </span>
            </div>
          </div>
          {/* Primary Text Content Button */}
          <button type="button" className="task-card-main">
            <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="task-card-title" title={task.title || "Untitled task"}>{task.is_locked ? getPrivateTaskTitle(task) : task.title || "Untitled task"}</h3>
            <p className="task-description" title={task.description || "No description added."}>{task.is_locked ? "This task is secured." : task.description || "No description added."}</p>
          </button>
        </div>
        <div className="task-list-right">
          {/* Card Layout Toggles */}
          <div className="task-list-actions">
            <button type="button" className={`common-pin-button ${task.is_pinned ? "pinned" : ""}`} onClick={(event) => handleTogglePin(event, task)} disabled={isProcessingAction} title={task.is_pinned ? "Unpin task" : "Pin task"} aria-label={task.is_pinned ? "Unpin task" : "Pin task"}>
              <i className={`fa-solid ${actionTaskId === task.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
            </button>
          </div>
          {/* Allocation Details */}
          <div className="task-list-assignee">
            <i className="fa-regular fa-user" /> <span>{assignee}</span>
          </div>
          {/* Target Schedule Limits */}
          <div className={`task-list-date ${isOverdue(task) ? "overdue" : ""}`}>
            <i className="fa-regular fa-calendar" /> <span>{task.due_date ? formatDate(task.due_date) : "Not Fixed"}</span>
          </div>
        </div>
      </article>
    ) : (
      // grid view
      <article className={`task-card ${task.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={task.id}  onClick={() => handleOpenTask(task)}>
        {/* Top Actions Bar */}
        <div className="task-card-top">
          <label className="select-label" onClick={(event) => event.stopPropagation()} title="Select task">
            <input type="checkbox" className="select-checkbox" checked={selected} onChange={(event) => toggleTaskSelection(event, task.id)} aria-label={`Select ${task.title || "task"}`} />
            <span className="select-checkmark" />
          </label>
          <div className="task-card-top-actions">
            <button type="button" className={`common-pin-button ${task.is_pinned ? "pinned" : ""}`} onClick={(event) => handleTogglePin(event, task)} disabled={isProcessingAction} title={task.is_pinned ? "Unpin task" : "Pin task"} aria-label={task.is_pinned ? "Unpin task" : "Pin task"}>
              <i className={`fa-solid ${actionTaskId === task.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
            </button>
          </div>
        </div>
        {/* Main Clickable Content Area */}
        <button type="button" className="task-card-main">
          <h3 className="task-card-title" title={task.title || "Untitled task"}>{task.is_locked ? getPrivateTaskTitle(task) : task.title || "Untitled task"}</h3>
          <p className="task-description">{task.is_locked ? "This task is secured." : task.description || "No description added."}</p>
        </button>
        {/* Card Metadata Badges */}
        <div className="task-card-meta">
          <span className={`task-priority priority-${priority}`}>
            <i className="fa-solid fa-flag" /> {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </span>
          <span className={`task-status status-${status}`}>
            {status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())}
          </span>
        </div>
        {/* Card Footer Group */}
        <div className="task-card-footer">
          <div className="task-assignee">
            <i className="fa-regular fa-user" /> <span>{assignee}</span>
          </div>
          <span className={`task-due-date ${isOverdue(task) ? "overdue" : ""}`}>
            <i className="fa-regular fa-calendar" /> {task.due_date ? formatDate(task.due_date) : "Not Fixed"}
          </span>
        </div>
      </article>
    );
  };

  // ========== Render Task Section ==========
  const renderTaskSection = (sectionTasks, sectionTitle) => (
    <section className="common-group" key={sectionTitle}>
      {/* Section Group Header */}
      <div className="common-group-heading">
        <h2><i className={sectionTitle === "Pinned" ? "fa-solid fa-thumbtack" : "fa-solid fa-check"} />{" "}{sectionTitle}</h2>
        <span>{sectionTasks.length}</span>
      </div>
      {/* Section Render Grid/List Wrapper */}
      <div className={`tasks-grid ${viewMode === "list" ? "tasks-list" : ""}`}>{sectionTasks.map(renderTaskCard)}</div>
    </section>
  );

  // ========== Loading State ==========
  if (isLoadingTasks) return <Loader message="Loading your tasks..." />;
  if (loadError) {
    return (
      <main className="common-page">
        <div className="common-error-state" role="alert">
          <i className="fa-solid fa-cloud-bolt" />
          <h2>Unable to load tasks</h2>
          <p>{loadError}</p>
          <button type="button" className="common-create-button" onClick={fetchTasks}><i className="fa-solid fa-rotate-right" />Retry</button>
          <button type="button" className="common-error-back-button" onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
        </div>
      </main>
    );
  }

  // ========== Main Tasks Page ==========
  return (
    <main className="common-page">
      {/* Header */}
      <header className="common-header">
        <div className="common-header-left">
          <button type="button" className="common-back-button" onClick={() => navigate("/dashboard")} title="Back to Dashboard" aria-label="Back to Dashboard">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <h1>Tasks</h1>
        </div>
        <button type="button" className="common-create-button" onClick={handleCreateNewTask}>
          <i className="fa-solid fa-plus" /><span>New Task</span>
        </button>
      </header>
      <section className="common-content">
        {/* Toolbar */}
        {sortedTasks.length > 0 && (
          <div className="common-toolbar">
            <div className="common-toolbar-left">
              <label className="common-sort-label">
                <i className="fa-solid fa-arrow-down-wide-short" />
                <select className="common-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort tasks">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title-asc">Title A - Z</option>
                  <option value="title-desc">Title Z - A</option>
                </select>
              </label>
              <span className="common-count">{sortedTasks.length}{" "}{sortedTasks.length === 1 ? "task" : "tasks"}</span>
              <button type="button" className="common-select-all-button" onClick={handleToggleSelectAll} aria-pressed={allTasksSelected}>{allTasksSelected ? "Deselect all" : "Select all"}</button>
            </div>
            <div className="common-toolbar-right">
              {selectedTaskIds.length > 0 && (
                <>
                  <span className="common-selection-count">{selectedTaskIds.length}selected</span>
                  <button type="button" className="common-bulk-delete-button" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting || isProcessingAction}>
                    <i className="fa-regular fa-trash-can" /><span>Move to Trash</span>
                  </button>
                </>
              )}
              <div className="common-toolbar-actions">
                {/* Grid / List Toggle */}
                <div className="common-view-toggle" aria-label="Task view">
                  <button type="button" className={viewMode === "grid" ? "pinned" : ""} onClick={() => setViewMode("grid")} title="Grid view" aria-label="Grid view" aria-pressed={viewMode === "grid"}>
                    <i className="fa-solid fa-grip" />
                  </button>
                  <button type="button" className={viewMode === "list" ? "pinned" : ""} onClick={() => setViewMode("list")} title="List view" aria-label="List view" aria-pressed={viewMode === "list"}>
                    <i className="fa-solid fa-list" />
                  </button>
                </div>
                {/* More Actions */}
                {selectedTaskIds.length > 0 && (
                  <div className="common-more-container">
                      <button type="button" className="common-more-button" title="More actions" aria-label="More task actions" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu((previous) => !previous)}>
                          <i className="fa-solid fa-ellipsis-vertical" />
                      </button>
                      {showMoreMenu && (
                        <>
                            <button type="button" className="common-menu-backdrop" aria-label="Close actions menu" onClick={() => setShowMoreMenu(false)} />
                            <div className="common-more-menu">
                                <button type="button" disabled={isProcessingAction} onClick={handleArchiveSelected}><i className="fa-regular fa-folder-open" /> <span>Archive</span></button>
                                <button type="button" disabled={isProcessingAction} onClick={handleSendSelected}><i className="fa-regular fa-paper-plane" /> <span>Send</span></button>
                                <button type="button" disabled={isProcessingAction} onClick={handleCopySelected}><i className="fa-regular fa-copy" /> <span>Make a copy</span></button>
                            </div>
                        </>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty State / Task Sections */}
        {sortedTasks.length === 0 ? (
          <div className="common-empty">
            <i className="fa-solid fa-check" />
            <h2>No Tasks Yet</h2>
            <p>Create your first task and start organizing your work.</p>
          </div>
        ) : (
          <div className="common-sections">
            {pinnedTasks.length > 0 && renderTaskSection(pinnedTasks, "Pinned")}
            {pinnedTasks.length > 0 && unpinnedTasks.length > 0 && (<div className="common-section-divider"><span /></div>)}
            {unpinnedTasks.length > 0 && renderTaskSection(unpinnedTasks, "Others")}
          </div>
        )}
      </section>

      {/* Create, view, or edit task modal */}
      {showTaskForm && (
        <div className="task-form-overlay" onMouseDown={(event) => event.target === event.currentTarget && !isSavingTask && handleCloseTaskForm()}>
          <form className="task-form" onSubmit={handleSaveTask} role="dialog" aria-modal="true" aria-labelledby="task-form-title">
            <div className="task-form-header">
              <div>
                <h2 id="task-form-title">{selectedTask ? isEditingTask ? "Edit Task" : "View Task": "Create Task"}</h2>
                <p>{selectedTask ? isEditingTask ? "Update your task details." : "View your task information." : "Add the details for your new task."}</p>
              </div>
              <div className="task-card-top-actions">
                {selectedTask && !isEditingTask && (
                  <button type="button" className="edit-icon-button" onClick={handleEditTask} title="Edit task" aria-label="Edit task">
                    <i className="fa-solid fa-pen" />
                  </button>
                )}
                {isEditingTask && (
                    <button type="button" className={`lock-button ${taskForm.is_locked ? "locked" : ""}`} onClick={handleToggleTaskLock} disabled={isSavingTask} aria-pressed={taskForm.is_locked}>
                      <i className={taskForm.is_locked ? "fa-solid fa-lock" : "fa-solid fa-lock-open"}/><span>{taskForm.is_locked ? "Secured" : "Open"}</span>
                    </button>
                )}
                <button type="button" className="close-icon-button" onClick={handleCloseTaskForm} disabled={isSavingTask} aria-label="Close task form">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <div className="task-form-body">
              {/* Title */}
              <label className="task-form-field">
                <span>Task title *</span>
                <input type="text" name="title" value={taskForm.title} onChange={handleTaskFormChange} placeholder="What do you need to do?" maxLength={200} readOnly={Boolean(selectedTask) && !isEditingTask} aria-invalid={Boolean(taskErrors.title)} aria-describedby={taskErrors.title ? "task-title-error" : undefined} autoFocus={!selectedTask} />
                {isEditingTask && taskErrors.title && (<small className="task-field-error" id="task-title-error" role="alert">{taskErrors.title}</small>)}
              </label>
              {/* Description */}
              <label className="task-form-field">
                <span>Description</span>
                <textarea name="description" value={taskForm.description} onChange={handleTaskFormChange} placeholder="Add details about this task..." rows={4} readOnly={Boolean(selectedTask) && !isEditingTask} aria-invalid={Boolean(taskErrors.description)} aria-describedby={taskErrors.description ? "task-description-error" : undefined} />
                {isEditingTask && taskErrors.description && (<small className="task-field-error" id="task-description-error" role="alert">{taskErrors.description}</small>)}
              </label>
              {/* Assigned To */}
              <label className="task-form-field">
                <span>Assigned to</span>
                <input type="text" name="assigned_to" value={taskForm.assigned_to} onChange={handleTaskFormChange} placeholder="Person responsible" readOnly={Boolean(selectedTask) && !isEditingTask} aria-invalid={Boolean(taskErrors.assigned_to)} aria-describedby={taskErrors.assigned_to ? "task-assigned-error" : undefined} />
                {isEditingTask && taskErrors.assigned_to && (<small className="task-field-error" id="task-assigned-error" role="alert">{taskErrors.assigned_to}</small>)}
              </label>
              {/* Priority and Status */}
              <div className="task-form-row">
                <label className="task-form-field">
                  <span>Priority</span>
                  <select name="priority" value={taskForm.priority} disabled={isSavingTask} onChange={(event) => selectedTask && !isEditingTask ? handleQuickUpdate("priority", event.target.value) : handleTaskFormChange(event)}>
                    <option value="">Select priority</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  {isEditingTask && taskErrors.priority && <small className="task-field-error" role="alert">{taskErrors.priority}</small>}
                </label>
                <label className="task-form-field">
                  <span>Status</span>
                  <select name="status" value={taskForm.status} disabled={isSavingTask} onChange={(event) => selectedTask && !isEditingTask ? handleQuickUpdate("status", event.target.value) : handleTaskFormChange(event)}>
                    <option value="">Select status</option>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                  {isEditingTask && taskErrors.status && <small className="task-field-error" role="alert">{taskErrors.status}</small>}
                </label>
              </div>
              {/* Due Date */}
              <label className="task-form-field">
                <span>Due date</span>
                {/* <input type="date" name="due_date" value={taskForm.due_date || ""} min={selectedTask?.due_date && selectedTask.due_date < getTodayDate() && taskForm.due_date === selectedTask.due_date ? selectedTask.due_date : getTodayDate()} onChange={handleTaskFormChange} aria-invalid={Boolean(taskErrors.due_date)} aria-describedby={taskErrors.due_date ? "task-due-date-error" : undefined} /> */}
                <CustomCalendar value={taskForm.due_date || ""} onChange={(val) => handleTaskFormChange({ target: { name: "due_date", value: val } })} min={selectedTask?.due_date && selectedTask.due_date < getTodayDate() && taskForm.due_date === selectedTask.due_date ? selectedTask.due_date : getTodayDate()} disabled={false} placeholder="Select due date" ariaLabel="Task due date" clearable={true} />
                {isEditingTask && taskErrors.due_date && <small className="task-field-error" id="task-due-date-error" role="alert">{taskErrors.due_date}</small>}
                {selectedTask?.due_date && selectedTask.due_date < getTodayDate() && taskForm.due_date === selectedTask.due_date && (
                  <small>This task is already overdue. Its existing due date will be preserved unless you change it.</small>
                )}
                {selectedTask && !isEditingTask && isOverdue(selectedTask) && (
                  <span className="task-due-date overdue">Overdue</span>
                )}
              </label>
              {taskForm.is_locked && (<p className="locked-message"><i className="fa-solid fa-lock" /> This task is marked as secured.</p>)}
            </div>
            <div className="form-actions">
              {isEditingTask ? (
                <>
                  <button type="button" className="clear-button" onClick={handleClearTaskForm} disabled={isSavingTask}>
                    <i className="fa-solid fa-eraser" /><span>Clear</span>
                  </button>
                  <button type="button" className="cancel-button" onClick={handleCloseTaskForm} disabled={isSavingTask}>
                    <i className="fa-solid fa-ban"></i><span>Cancel</span>
                  </button>
                  <button type="submit" className="save-button" disabled={isSavingTask || !taskForm.title.trim() || !taskForm.priority || !taskForm.status}>
                    <i className={`fa-solid ${isSavingTask ? "fa-spinner fa-spin" : "fa-check"}`} />
                    <span>{isSavingTask ? "Saving..." : selectedTask ? "Save Changes" : "Save Task"}</span>
                  </button>
                </>
              ) : (
                <button type="button" className="cancel-button" onClick={handleCloseTaskForm} disabled={isSavingTask}>
                  <i className="fa-solid fa-xmark"></i><span>Close</span>
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Card Password Navigation */}
      {showSecurePrompt && (
          <div className="modal-overlay">
              <div className="modal-content secure-password-prompt" role="dialog" aria-modal="true" aria-labelledby="secure-prompt-title">
                  <h2 id="secure-prompt-title">Card Lock Password Required</h2>
                  <p>First add a Card Lock Password, then come back to secure your task.</p>
                  <div className="modal-actions">
                      <button type="button" className="save-button" onClick={() => {navigate("/account", {state: { focusCardLockPassword: true },});}}>Add Password</button>
                      <button type="button" className="cancel-button" onClick={() => setShowSecurePrompt(false)}>Cancel</button>
                  </div>
              </div>
          </div>
      )}

      {/* Unlock Secured Task */}
      {showUnlockPrompt && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isVerifyingPassword) { setshowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setShowSecurePassword(false); setSecureAction(""); setSecureActionTaskIds([]); setSelectedTask(null); } }}>
          <form className="modal-content secure-password-prompt" role="dialog" aria-modal="true" aria-labelledby="unlock-task-title" onSubmit={handleVerifySecurePassword}>
            <h2 id="unlock-task-title">{secureAction === "copy" ? "Verify Password to Copy" : secureAction === "send" ? "Verify Password to Send" : "Unlock Private Task"}</h2>
            <p>{secureAction === "copy" ? "Enter your Card Lock Password to copy the selected secured tasks." : secureAction === "send" ? "Enter your Card Lock Password to send the selected secured tasks." : "Enter your Card Lock Password to view this task."}</p>
            <div className="modal-field">
              <label className="password-title" htmlFor="unlock-note-password">Card Lock Password</label>
              <div className="password-input-wrapper">
                <input id="unlock-task-password" type={showSecurePassword ? "text" : "password"} value={securePassword} onChange={(e) => { setSecurePassword(e.target.value); setSecurePasswordError(""); }} placeholder="Enter your password" autoComplete="current-password" autoFocus disabled={isVerifyingPassword} />
                <button type="button" className="password-toggle-button" onClick={() => setShowSecurePassword((prev) => !prev)} aria-label={showSecurePassword ? "Hide password" : "Show password"} title={showSecurePassword ? "Hide password" : "Show password"} disabled={isVerifyingPassword}>
                  <i className={showSecurePassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                </button>
              </div>
            </div>
            {securePasswordError && <p className="modal-field-error" role="alert">{securePasswordError}</p>}
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => { if (!isVerifyingPassword) { setshowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setShowSecurePassword(false); setSecureAction(""); setSecureActionTaskIds([]); setSelectedTask(null); } }} disabled={isVerifyingPassword}>Cancel</button>
              <button type="submit" className="save-button" disabled={isVerifyingPassword || !securePassword.trim()}>{isVerifyingPassword ? "Verifying..." : secureAction === "copy" ? "Verify & Copy" : secureAction === "send" ? "Verify & Send" : "Unlock Task"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Popup notification */}
      {popup.show && (
        <div className={`focus-popup ${popup.type}`} role="status" aria-live="polite">
          <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
          <span>{popup.message}</span>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      {showBulkDeleteConfirm && (
        <div className="delete-confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && !isBulkDeleting && setShowBulkDeleteConfirm(false)}>
          <div className="delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
            <div className="delete-confirm-icon"><i className="fa-regular fa-trash-can" /></div>
            <h3 id="bulk-delete-title">Move selected tasks to Trash?</h3>
            <p>You are about to move <strong>{selectedTaskIds.length} {selectedTaskIds.length === 1 ? "task" : "tasks"}</strong> to Trash. You can restore them later from the Trash page.</p>
            <div className="delete-confirm-actions">
              <button type="button" className="delete-cancel-button" onClick={() => setShowBulkDeleteConfirm(false)} disabled={isBulkDeleting}>Cancel</button>
              <button type="button" className="delete-confirm-button" onClick={confirmBulkDelete} disabled={isBulkDeleting}>{isBulkDeleting ? "Moving..." : "Move to Trash"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Tasks;