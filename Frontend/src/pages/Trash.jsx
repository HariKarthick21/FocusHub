import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDeletedNotes, restoreNote, permanentlyDeleteNote, verifyCardLockPassword } from "../services/noteService";
import { getDeletedLists, restoreList, permanentlyDeleteList } from "../services/listService";
import { getDeletedTasks, restoreTask, permanentlyDeleteTask } from "../services/taskService";
import Loader from "../components/Loader";

function Trash() {
  const [notes, setNotes] = useState([]);
  const [lists, setLists] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [selectedListIds, setSelectedListIds] = useState([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const menuRef = useRef(null);
  const operationLockRef = useRef(false);
  const mountedRef = useRef(false);

  const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false);
  const [showDeletePasswordPrompt, setShowDeletePasswordPrompt] = useState(false);
  const [isDeletePasswordVerified, setIsDeletePasswordVerified] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [isVerifyingDeletePassword, setIsVerifyingDeletePassword] = useState(false);

  const navigate = useNavigate();

  const getResponseItems = (response) => {
    const data = response?.data;
    return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
  };

  const isSuccessfulResponse = (response) => {
    const status = Number(response?.status ?? 200);
    return status >= 200 && status < 300;
  };

  const getNoteTitle = (note) => {
    if (!note) return "";
    if (note.is_locked) {
      const actualTitle = String(note.title || "").trim();
      if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
      const lockedNotes = notes.filter((item) => item.is_locked).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB || Number(a.id) - Number(b.id);
      });
      const index = lockedNotes.findIndex((item) => String(item.id) === String(note.id));
      return index >= 0 ? `Private Notes (${index + 1})` : actualTitle || "Private Notes";
    }
    return String(note.title || "").trim() || "Untitled note";
  };

  const getListTitle = (list) => {
    if (!list) return "";
    if (list.is_locked) {
      const actualTitle = String(list.title || list.name || "").trim();
      if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
      const lockedLists = lists.filter((item) => item.is_locked).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB || Number(a.id) - Number(b.id);
      });
      const index = lockedLists.findIndex((item) => String(item.id) === String(list.id));
      return index >= 0 ? `Private Lists (${index + 1})` : actualTitle || "Private Lists";
    }
    return (String(list.title || "").trim() || String(list.name || "").trim() || "Untitled list");
  };

  const getTaskTitle = (task) => {
    if (!task) return "";
    if (task.is_locked) {
      const actualTitle = String(task.title || "").trim();
      if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
      const lockedTasks = tasks.filter((item) => item.is_locked).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB || Number(a.id) - Number(b.id);
      });
      const index = lockedTasks.findIndex((item) => String(item.id) === String(task.id));
      return index >= 0 ? `Private Tasks (${index + 1})` : actualTitle || "Private Tasks";
    }
    return String(task.title || "").trim() || "Untitled task";
  };

  const getNoteContent = (note) => {
    if (note?.is_locked) return "🔒 Private note content is hidden";
    return note?.content?.trim() || "No content";
  };
  const getListDescription = (list) => {
    if (list?.is_locked) return "🔒 Private list content is hidden";
    return list?.description?.trim() || "No description";
  };

  const getTaskDescription = (task) => {
    if (task?.is_locked) return "🔒 Private task content is hidden";
    return task?.description?.trim() || "No description";
  };
  // Fetch deleted notes and lists.
  const fetchTrashItems = useCallback(async () => {
    if (mountedRef.current) {
      setIsLoading(true);
      setErrorMessage("");
    }

    try {
      const [notesResponse, listsResponse, tasksResponse] =
        await Promise.all([
          getDeletedNotes(),
          getDeletedLists(),
          getDeletedTasks(),
        ]);

      if (
        !isSuccessfulResponse(notesResponse) ||
        !isSuccessfulResponse(listsResponse) ||
        !isSuccessfulResponse(tasksResponse)
      ) {
        throw new Error("Failed to load Trash items.");
      }

      if (!mountedRef.current) return;

      setNotes(getResponseItems(notesResponse));
      setLists(getResponseItems(listsResponse));
      setTasks(getResponseItems(tasksResponse));

      setSelectedNoteIds([]);
      setSelectedListIds([]);
      setSelectedTaskIds([]);
    } catch (error) {
      console.error("Failed to load Trash:", error);

      if (mountedRef.current) {
        setErrorMessage(
          "Unable to load Trash. Please check your connection and try again."
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTrashItems();
    return () => {mountedRef.current = false;};
  }, [fetchTrashItems]);

  // Close the action menu when clicking outside or pressing Escape.
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleOutsideClick = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    };
    const handleEscapeKey = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isMenuOpen]);

  // Close the confirmation modal using Escape.
  useEffect(() => {
    if (!showPermanentDeleteModal || isProcessing) {
      return undefined;
    }
    const handleEscapeKey = (event) => {
      if (event.key === "Escape") {
        setIsDeletePasswordVerified(false);
        setShowPermanentDeleteModal(false);
      }
    };
    document.addEventListener("keydown", handleEscapeKey);
    return () => {document.removeEventListener("keydown", handleEscapeKey)};
  }, [showPermanentDeleteModal, isProcessing]);

  const isNoteSelected = (noteId) => selectedNoteIds.some((id) => String(id) === String(noteId));
  const isListSelected = (listId) =>selectedListIds.some((id) => String(id) === String(listId));
  const isTaskSelected = (taskId) => selectedTaskIds.some((id) => String(id) === String(taskId));

  const toggleNoteSelection = (noteId) => {
    if (isProcessing) return;
    setSelectedNoteIds((previousIds) =>
      previousIds.some((id) => String(id) === String(noteId)) ? previousIds.filter((id) => String(id) !== String(noteId)) : [...previousIds, noteId]
    );
  };

  const toggleListSelection = (listId) => {
    if (isProcessing) return;
    setSelectedListIds((previousIds) =>
      previousIds.some((id) => String(id) === String(listId)) ? previousIds.filter((id) => String(id) !== String(listId)) : [...previousIds, listId]
    );
  };

  const toggleTaskSelection = (taskId) => {
    if (isProcessing) return;
    setSelectedTaskIds((previousIds) =>
      previousIds.some((id) => String(id) === String(taskId)) ? previousIds.filter((id) => String(id) !== String(taskId)): [...previousIds, taskId]
    );
  };

  // ========== Select or deselect all note, list, task ==========
  const allItems = [
    ...notes.map((item) => ({ ...item, trashType: "note" })),
    ...lists.map((item) => ({ ...item, trashType: "list" })),
    ...tasks.map((item) => ({ ...item, trashType: "task" })),
  ];
  const totalItems = notes.length + lists.length + tasks.length;
  const selectedCount = selectedNoteIds.length + selectedListIds.length + selectedTaskIds.length;
  const allItemsSelected = totalItems > 0 && selectedNoteIds.length === notes.length && selectedListIds.length === lists.length && selectedTaskIds.length === tasks.length;
  const handleSelectAll = () => {
    if (isProcessing || totalItems === 0) return;
    if (allItemsSelected) {
      setSelectedNoteIds([]);
      setSelectedListIds([]);
      setSelectedTaskIds([]);
    } else {
      setSelectedNoteIds(notes.map((note) => note.id));
      setSelectedListIds(lists.map((list) => list.id));
      setSelectedTaskIds(tasks.map((task) => task.id));
    }
  };
  const clearMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  // ========== Restore particular note, list and task ==========
  const handleRestoreNote = async (noteId) => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setIsProcessing(true);
    clearMessages();
    try {
      const response = await restoreNote(noteId);
      if (!isSuccessfulResponse(response)) {
        throw new Error("Failed to restore note.");
      }
      if (!mountedRef.current) return;
      setNotes((previous) => previous.filter((note) => String(note.id) !== String(noteId)));
      setSelectedNoteIds((previous) =>previous.filter((id) => String(id) !== String(noteId)));
      setSuccessMessage("Note restored successfully.");
    } catch (error) {
      console.error("Unable to restore note:", error);
      if (mountedRef.current) {
        setErrorMessage(error?.response?.data?.error || error?.message || "Unable to restore note. Please try again.");
      }
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRestoreList = async (listId) => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setIsProcessing(true);
    clearMessages();
    try {
      const response = await restoreList(listId);
      if (!isSuccessfulResponse(response)) {
        throw new Error("Failed to restore list.");
      }
      if (!mountedRef.current) return;
      setLists((previous) => previous.filter((list) => String(list.id) !== String(listId)));
      setSelectedListIds((previous) => previous.filter((id) => String(id) !== String(listId)));
      setSuccessMessage("List restored successfully.");
    } catch (error) {
      console.error("Unable to restore list:", error);
      if (mountedRef.current) {
        setErrorMessage(error?.response?.data?.error || error?.message || "Unable to restore list. Please try again.");
      }
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRestoreTask = async (taskId) => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setIsProcessing(true);
    clearMessages();
    try {
      const response = await restoreTask(taskId);
      if (!isSuccessfulResponse(response)) {
        throw new Error("Failed to restore task.");
      }
      if (!mountedRef.current) return;
      setTasks((previous) => previous.filter((task) => String(task.id) !== String(taskId)));
      setSelectedTaskIds((previous) => previous.filter((id) => String(id) !== String(taskId)));
      setSuccessMessage("Task restored successfully.");
    } catch (error) {
      console.error("Unable to restore task:", error);
      if (mountedRef.current) {
        setErrorMessage(error?.response?.data?.error || error?.message || "Unable to restore task. Please try again."
        );
      }
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  // ========== Restore selected note, list, and task ==========
  const handleBulkRestore = async () => {
    if (operationLockRef.current || selectedCount === 0) return;
    operationLockRef.current = true;
    setIsProcessing(true);
    setIsMenuOpen(false);
    clearMessages();

    const noteIds = [...selectedNoteIds];
    const listIds = [...selectedListIds];
    const taskIds = [...selectedTaskIds];

    const restoredNoteIds = [];
    const restoredListIds = [];
    const restoredTaskIds = [];

    const failedNoteIds = [];
    const failedListIds = [];
    const failedTaskIds = [];

    try {
      for (const noteId of noteIds) {
        try {
          const response = await restoreNote(noteId);
          if (isSuccessfulResponse(response)) {
            restoredNoteIds.push(noteId);
          } else {
            failedNoteIds.push(noteId);
          }
        } catch (error) {
          console.error(`Failed to restore note ${noteId}:`, error);
          failedNoteIds.push(noteId);
        }
      }

      for (const listId of listIds) {
        try {
          const response = await restoreList(listId);
          if (isSuccessfulResponse(response)) {
            restoredListIds.push(listId);
          } else {
            failedListIds.push(listId);
          }
        } catch (error) {
          console.error(`Failed to restore list ${listId}:`, error);
          failedListIds.push(listId);
        }
      }

      for (const taskId of taskIds) {
        try {
          const response = await restoreTask(taskId);
          if (isSuccessfulResponse(response)) {
            restoredTaskIds.push(taskId);
          } else {
            failedTaskIds.push(taskId);
          }
        } catch (error) {
          console.error(`Failed to restore task ${taskId}:`, error);
          failedTaskIds.push(taskId);
        }
      }

      if (!mountedRef.current) return;

      setNotes((previous) =>
        previous.filter((note) =>
          !restoredNoteIds.some((id) => String(id) === String(note.id))
        )
      );

      setLists((previous) =>
        previous.filter((list) =>
          !restoredListIds.some((id) => String(id) === String(list.id))
        )
      );

      setTasks((previous) =>
        previous.filter((task) =>
          !restoredTaskIds.some((id) => String(id) === String(task.id))
        )
      );

      setSelectedNoteIds(failedNoteIds);
      setSelectedListIds(failedListIds);
      setSelectedTaskIds(failedTaskIds);

      const restoredCount = restoredNoteIds.length + restoredListIds.length +restoredTaskIds.length;
      const failedCount = failedNoteIds.length + failedListIds.length +failedTaskIds.length;

      if (restoredCount > 0) {
        setSuccessMessage(
          `${restoredCount} item(s) restored successfully.`
        );
      }

      if (failedCount > 0) {
        setErrorMessage(
          `${failedCount} item(s) could not be restored. Failed items remain selected.`
        );
      }

    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  // ========== Open permanent delete confirmation ==========
  const handleVerifyDeletePassword = async (event) => {
    event.preventDefault();
    if (isVerifyingDeletePassword || !deletePassword.trim()) return;
    setIsVerifyingDeletePassword(true);
    setDeletePasswordError("");
    try {
      const response = await verifyCardLockPassword(deletePassword);
      if (response.status >= 200 && response.status < 300) {
        setIsDeletePasswordVerified(true);
        setShowDeletePasswordPrompt(false);
        setDeletePassword("");
        setDeletePasswordError("");
        setShowDeletePassword(false);
        setShowPermanentDeleteModal(true);
      } else {
        setDeletePasswordError(
          response.data?.error ||
          response.data?.message ||
          "Incorrect Card Lock Password. Please try again."
        );
      }
    } catch (error) {
      console.error("Card Lock Password verification failed:", error);
      setDeletePasswordError("Unable to verify your password. Please try again.");
    } finally {
      setIsVerifyingDeletePassword(false);
    }
  };

  const openPermanentDeleteModal = (type = null, id = null) => {
    if (operationLockRef.current) return;
    setIsMenuOpen(false);
    clearMessages();
    setIsDeletePasswordVerified(false);
    if (type === "note" && id !== null) {
      const selectedNote = notes.find((n) => String(n.id) === String(id));
      setSelectedNoteIds([id]);
      setSelectedListIds([]);
      setSelectedTaskIds([]);
      if (selectedNote?.is_locked) {
        setDeletePassword("");
        setDeletePasswordError("");
        setShowDeletePassword(false);
        setShowPermanentDeleteModal(false);
        setShowDeletePasswordPrompt(true);
        return;
      }
    } else if (type === "list" && id !== null) {
      const selectedList = lists.find((l) => String(l.id) === String(id));
      setSelectedListIds([id]);
      setSelectedNoteIds([]);
      setSelectedTaskIds([]);
      if (selectedList?.is_locked) {
        setDeletePassword("");
        setDeletePasswordError("");
        setShowDeletePassword(false);
        setShowPermanentDeleteModal(false);
        setShowDeletePasswordPrompt(true);
        return;
      }
    }  else if (type === "task" && id !== null) {
        const selectedTask = tasks.find(
          (task) => String(task.id) === String(id)
        );
        setSelectedTaskIds([id]);
        setSelectedNoteIds([]);
        setSelectedListIds([]);
        if (selectedTask?.is_locked) {
          setDeletePassword("");
          setDeletePasswordError("");
          setShowDeletePassword(false);
          setShowPermanentDeleteModal(false);
          setShowDeletePasswordPrompt(true);
          return;
        }
      } else {
      if (hasSelectedLockedNotes || hasSelectedLockedLists || hasSelectedLockedTasks) {
        setDeletePassword("");
        setDeletePasswordError("");
        setShowDeletePassword(false);
        setShowPermanentDeleteModal(false);
        setShowDeletePasswordPrompt(true);
        return;
      }
    }
    setShowPermanentDeleteModal(true);
  };

  // ========== Permanently delete all selected note, list, and task  ==========
  const handleBulkPermanentDelete = async () => {
    if (operationLockRef.current || selectedCount === 0) return;
    setIsMenuOpen(false);
    clearMessages();
    const hasLockedItems = selectedNotes.some((note) => Boolean(note.is_locked)) || selectedLists.some((list) => Boolean(list.is_locked)) || selectedTasks.some((task) => Boolean(task.is_locked));
    if (hasLockedItems && !isDeletePasswordVerified) {
      setDeletePassword("");
      setDeletePasswordError("");
      setShowDeletePassword(false);
      setShowPermanentDeleteModal(false);
      setShowDeletePasswordPrompt(true);
      return;
    }
    operationLockRef.current = true;
    setIsProcessing(true);
    setIsDeletePasswordVerified(false);
    setShowPermanentDeleteModal(true);

    const noteIds = [...selectedNoteIds];
    const listIds = [...selectedListIds];
    const taskIds = [...selectedTaskIds];

    const deletedNoteIds = [];
    const deletedListIds = [];
    const deletedTaskIds = [];

    const failedNoteIds = [];
    const failedListIds = [];
    const failedTaskIds = [];

    try {
      for (const noteId of noteIds) {
        try {
          const response = await permanentlyDeleteNote(noteId);
          if (isSuccessfulResponse(response)) {
            deletedNoteIds.push(noteId);
          } else {
            failedNoteIds.push(noteId);
          }
        } catch (error) {
          console.error(`Failed to permanently delete note ${noteId}:`, error);
          failedNoteIds.push(noteId);
        }
      }

      for (const listId of listIds) {
        try {
          const response = await permanentlyDeleteList(listId);
          if (isSuccessfulResponse(response)) {
            deletedListIds.push(listId);
          } else {
            failedListIds.push(listId);
          }
        } catch (error) {
          console.error(`Failed to permanently delete list ${listId}:`, error);
          failedListIds.push(listId);
        }
      }

      for (const taskId of taskIds) {
        try {
          const response = await permanentlyDeleteTask(taskId);
          if (isSuccessfulResponse(response)) {
            deletedTaskIds.push(taskId);
          } else {
            failedTaskIds.push(taskId);
          }
        } catch (error) {
          console.error(`Failed to permanently delete task ${taskId}:`, error);
          failedTaskIds.push(taskId);
        }
      }

      if (!mountedRef.current) return;

      setNotes((previous) =>
        previous.filter((note) =>
          !deletedNoteIds.some((id) => String(id) === String(note.id))
        )
      );

      setLists((previous) =>
        previous.filter((list) =>
          !deletedListIds.some((id) => String(id) === String(list.id))
        )
      );

      setTasks((previous) =>
        previous.filter((task) =>
          !deletedTaskIds.some((id) => String(id) === String(task.id))
        )
      );

      setSelectedNoteIds(failedNoteIds);
      setSelectedListIds(failedListIds);
      setSelectedTaskIds(failedTaskIds);
      setShowPermanentDeleteModal(false);

      const deletedCount = deletedNoteIds.length + deletedListIds.length + deletedTaskIds.length;
      const failedCount = failedNoteIds.length + failedListIds.length + failedTaskIds.length;

      if (deletedCount > 0) {
        setSuccessMessage(
          `${deletedCount} item(s) permanently deleted.`
        );
      }

      if (failedCount > 0) {
        setErrorMessage(
          `${failedCount} item(s) could not be permanently deleted. Failed items remain selected.`
        );
      }
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  // ========== Selecting Trash ==========
  const selectedNotes = notes.filter((note) =>isNoteSelected(note.id));
  const selectedLists = lists.filter((list) => isListSelected(list.id));
  const selectedTasks = tasks.filter((task) => isTaskSelected(task.id));
  const hasSelectedLockedNotes = selectedNotes.some((note) => Boolean(note.is_locked));
  const hasSelectedLockedLists = selectedLists.some((list) => Boolean(list.is_locked));
  const hasSelectedLockedTasks = selectedTasks.some((task) => Boolean(task.is_locked));

  const selectedLabels = [
    ...selectedNotes.map(getNoteTitle),
    ...selectedLists.map(getListTitle),
    ...selectedTasks.map(getTaskTitle),
  ];

  // ========== Loading Trash ==========
  if (isLoading) return <Loader message="Loading your Trash..." />;

  // ========== Main Trash ==========
  return (
    <main className="trash-page">
      {/* Header */}
      <div className="trash-header-row">
        <div className="trash-header">
          <button type="button" className="trash-back-button" onClick={() => navigate(-1)} aria-label="Go back" title="Go back">
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          </button>
          <div className="trash-title-group">
            <h1><i className="fa-solid fa-trash-can" aria-hidden="true" /> Trash</h1>
            <p>Deleted notes, lists, and tasks stay here until you restore or permanently delete them.</p>
          </div>
        </div>
        <div className="trash-menu-container" ref={menuRef}>
          <button type="button" className="trash-menu-button" onClick={() => setIsMenuOpen((previous) => !previous)} aria-label="Trash actions" aria-expanded={isMenuOpen} aria-haspopup="menu" title="Trash actions" disabled={totalItems === 0 || isProcessing}>
            <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
          </button>
          {isMenuOpen && (
            <div className="trash-menu-dropdown" role="menu">
              <button type="button" role="menuitem" className="trash-menu-item restore-menu-item" disabled={selectedCount === 0 || isProcessing} onClick={handleBulkRestore}>
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Restore selected <span className="trash-menu-count">{selectedCount}</span>
              </button>
              <button type="button" role="menuitem" className="trash-menu-item permanent-delete-menu-item" disabled={selectedCount === 0 || isProcessing} onClick={() => openPermanentDeleteModal()}>
                <i className="fa-solid fa-trash" aria-hidden="true" /> Permanently delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Select all notes, lists and tasks */}
      {totalItems > 0 && (
        <div className="trash-selection-row">
          <label htmlFor="trash-select-all">
            <input id="trash-select-all" type="checkbox" checked={allItemsSelected} onChange={handleSelectAll} disabled={isProcessing}/>
            {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
          </label>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="trash-error-message" role="alert">
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <span>{errorMessage}</span>
          <button type="button" className="trash-retry-button" onClick={fetchTrashItems} disabled={isProcessing}>Retry</button>
          <button type="button" className="trash-dismiss-button" onClick={() => setErrorMessage("")} aria-label="Dismiss error">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="trash-success-message" role="status">
          <i className="fa-solid fa-circle-check" aria-hidden="true" />
          <span>{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage("")} aria-label="Dismiss success message">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {totalItems === 0 ? (
          <section className="trash-empty">
            <i className="fa-regular fa-trash-can" aria-hidden="true" />
            <h2>Trash is empty</h2>
            <p>Deleted notes, lists, and tasks will appear here.</p>
          </section>
      ):(
        <>
          {/* Notes section */}
          {notes.length > 0 && (
            <section className="trash-section" aria-labelledby="trash-notes-heading">
              <div className="trash-section-header">
                <h2 id="trash-notes-heading">Notes</h2>
                <span className="trash-section-count">{notes.length}</span>
              </div>
              <div className="trash-notes-grid">
                {notes.map((note) => {
                  const isSelected = isNoteSelected(note.id);
                  const noteTitle = getNoteTitle(note);
                  return (
                    <article className={`trash-note-card ${isSelected ? "selected" : ""}`} key={`note-${note.id}`}>
                      <label className="trash-note-select">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleNoteSelection(note.id)} disabled={isProcessing} aria-label={`Select ${noteTitle}`} />
                        <span className="trash-note-checkmark" />
                      </label>
                      <h3 title={noteTitle}>{noteTitle}</h3>
                      <p className="trash-note-content">{getNoteContent(note)}</p>
                      <span className="trash-note-status"><i className="fa-solid fa-trash-can" aria-hidden="true" /> Deleted note</span>
                      <div className="trash-note-actions">
                        <button type="button" className="restore-note-button" disabled={isProcessing} onClick={() => handleRestoreNote(note.id)} aria-label={`Restore ${noteTitle}`} title="Restore note">
                          <i className="fa-solid fa-rotate-left" aria-hidden="true" /> <span>Restore</span>
                        </button>
                        <button type="button" className="permanent-delete-button" disabled={isProcessing} onClick={() => openPermanentDeleteModal("note", note.id)} aria-label={`Permanently delete ${noteTitle}`} title="Permanently delete note">
                          <i className="fa-solid fa-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Lists section */}
          {lists.length > 0 && (
            <section className="trash-section" aria-labelledby="trash-lists-heading">
              <div className="trash-section-header">
                <h2 id="trash-lists-heading">Lists</h2>
                <span className="trash-section-count">{lists.length}</span>
              </div>
              <div className="trash-lists-grid trash-notes-grid">
                {lists.map((list) => {
                  const isSelected = isListSelected(list.id);
                  const listTitle = getListTitle(list);
                  const taskCount = list.is_locked ? null : Array.isArray(list.tasks) ? list.tasks.length : Array.isArray(list.items) ? list.items.length : null;
                  return (
                    <article className={`trash-note-card trash-list-card ${isSelected ? "selected" : ""}`} key={`list-${list.id}`}>
                      <label className="trash-note-select">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleListSelection(list.id)} disabled={isProcessing} aria-label={`Select ${listTitle}`} />
                        <span className="trash-note-checkmark" />
                      </label>
                      <h3 title={listTitle}>{listTitle}</h3>
                      <p className="trash-note-content">{getListDescription(list)}</p>
                      {taskCount !== null && <p className="trash-list-task-count">{taskCount} {taskCount === 1 ? "item" : "items"}</p>}
                      <span className="trash-note-status"><i className="fa-solid fa-list-check" aria-hidden="true" /> Deleted list</span>
                      <div className="trash-note-actions">
                        <button type="button" className="restore-note-button" disabled={isProcessing} onClick={() => handleRestoreList(list.id)} aria-label={`Restore ${listTitle}`} title="Restore list">
                          <i className="fa-solid fa-rotate-left" aria-hidden="true" /> <span>Restore</span>
                        </button>
                        <button type="button" className="permanent-delete-button" disabled={isProcessing} onClick={() => openPermanentDeleteModal("list", list.id)} aria-label={`Permanently delete ${listTitle}`} title="Permanently delete list">
                          <i className="fa-solid fa-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Task Section */}
          {tasks.length > 0 && (
            <section className="trash-section" aria-labelledby="trash-tasks-heading">
              <div className="trash-section-header">
                <h2 id="trash-tasks-heading">Tasks</h2>
                <span className="trash-section-count">{tasks.length}</span>
              </div>
              <div className="trash-notes-grid">
                {tasks.map((task) => {
                  const isSelected = isTaskSelected(task.id);
                  const taskTitle = getTaskTitle(task);
                  return (
                    <article className={`trash-note-card trash-task-card ${isSelected ? "selected" : ""}`} key={`task-${task.id}`}>
                      <label className="trash-note-select">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleTaskSelection(task.id)} disabled={isProcessing} aria-label={`Select ${taskTitle}`} />
                        <span className="trash-note-checkmark" />
                      </label>
                      <h3 title={taskTitle}>{taskTitle}</h3>
                      <p className="trash-note-content">{getTaskDescription(task)}</p>
                      <span className="trash-note-status"><i className="fa-solid fa-check" aria-hidden="true" /> Deleted task</span>
                      <div className="trash-note-actions">
                        <button type="button" className="restore-note-button" disabled={isProcessing} onClick={() => handleRestoreTask(task.id)} aria-label={`Restore ${taskTitle}`} title="Restore task">
                          <i className="fa-solid fa-rotate-left" aria-hidden="true" /> <span>Restore</span>
                        </button>
                        <button type="button" className="permanent-delete-button" disabled={isProcessing} onClick={() => openPermanentDeleteModal("task", task.id)} aria-label={`Permanently delete ${taskTitle}`} title="Permanently delete task">
                          <i className="fa-solid fa-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* Verify Card Lock Password before permanent deletion */}
      {showDeletePasswordPrompt && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isVerifyingDeletePassword) { setIsDeletePasswordVerified(false); setShowDeletePasswordPrompt(false); setDeletePassword(""); setDeletePasswordError(""); setShowDeletePassword(false); } }}>
          <form className="modal-content secure-password-prompt" role="dialog" aria-modal="true" aria-labelledby="delete-password-title" onSubmit={handleVerifyDeletePassword}>
            <h2 id="delete-password-title">Verify Card Lock Password</h2>
            <p>Enter your Card Lock Password to permanently delete the selected private note or list or task.</p>
            <div className="modal-field">
              <label className="password-title" htmlFor="delete-card-lock-password">Card Lock Password</label>
              <div className="password-input-wrapper">
                <input id="delete-card-lock-password" type={showDeletePassword ? "text" : "password"} value={deletePassword} onChange={(e) => { setDeletePassword(e.target.value); setDeletePasswordError(""); }} placeholder="Enter your password" autoComplete="current-password" autoFocus disabled={isVerifyingDeletePassword} />
                <button type="button" className="password-toggle-button" onClick={() => setShowDeletePassword((prev) => !prev)} aria-label={showDeletePassword ? "Hide password" : "Show password"} title={showDeletePassword ? "Hide password" : "Show password"} disabled={isVerifyingDeletePassword}>
                  <i className={showDeletePassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                </button>
              </div>
            </div>
            {deletePasswordError && <p className="modal-field-error" role="alert">{deletePasswordError}</p>}
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => { setIsDeletePasswordVerified(false); setShowDeletePasswordPrompt(false); setDeletePassword(""); setDeletePasswordError(""); setShowDeletePassword(false); }} disabled={isVerifyingDeletePassword}>Cancel</button>
              <button type="submit" className="save-button" disabled={isVerifyingDeletePassword || !deletePassword.trim()}>{isVerifyingDeletePassword ? "Verifying..." : "Verify Password"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Permanent-delete confirmation modal */}
      {showPermanentDeleteModal && (
        <div className="trash-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !isProcessing && setShowPermanentDeleteModal(false)}>
          <div className="trash-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="trash-confirm-title" aria-describedby="trash-confirm-description">
            <div className="trash-confirm-icon"><i className="fa-solid fa-trash" aria-hidden="true" /></div>
            <h2 id="trash-confirm-title">Permanently delete {selectedCount === 1 ? "this item?" : "these items?"}</h2>
            <p id="trash-confirm-description">You are about to permanently delete <strong>{selectedCount === 1 ? selectedLabels[0] || "this item" : `${selectedCount} items`}</strong>. This action cannot be undone.</p>
            {selectedCount > 1 && (
              <ul className="trash-confirm-note-list">
                {selectedLabels.slice(0, 5).map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}
                {selectedCount > 5 && <li>And {selectedCount - 5} more...</li>}
              </ul>
            )}
            <div className="trash-confirm-actions">
              <button type="button" className="trash-cancel-button" disabled={isProcessing} onClick={() => {setIsDeletePasswordVerified(false); setShowPermanentDeleteModal(false);}}>Cancel</button>
              <button type="button" className="trash-confirm-delete-button" disabled={isProcessing || selectedCount === 0} onClick={handleBulkPermanentDelete}>
                <i className="fa-solid fa-trash" aria-hidden="true" /> {isProcessing ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Trash;
