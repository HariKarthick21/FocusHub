import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getNotes, getNoteById, createNote, updateNote, deleteNote, archiveNote, copyNote, shareNote, getArchivedNotes, toggleNotePin, verifyCardLockPassword } from "../services/noteService";
import { getAccountStatus } from "../services/accountService";
import Loader from "../components/Loader";
import "../index.css";

const EMPTY_NOTE = { title: "", content: "", is_locked: false };

function Notes() {
    const popupTimeoutRef = useRef(null);
    const navigate = useNavigate();
    const location = useLocation();

    const [notes, setNotes] = useState([]);
    const [selectedNoteIds, setSelectedNoteIds] = useState([]);
    const [selectedNote, setSelectedNote] = useState(null);

    const [isLoadingNotes, setIsLoadingNotes] = useState(true);
    const [loadError, setLoadError] = useState("");

    const [showNoteForm, setShowNoteForm] = useState(false);
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [isSavingNote, setIsSavingNote] = useState(false);

    const [noteForm, setNoteForm] = useState({ ...EMPTY_NOTE });
    const [noteErrors, setNoteErrors] = useState({});

    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    const [sortBy, setSortBy] = useState("newest");
    const [viewMode, setViewMode] = useState("grid");
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    const [actionNoteId, setActionNoteId] = useState(null);
    const [isProcessingAction, setIsProcessingAction] = useState(false);

    const [cardLockPasswordSet, setCardLockPasswordSet] = useState(false);
    const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
    const [showSecurePrompt, setShowSecurePrompt] = useState(false);

    const [securePassword, setSecurePassword] = useState("");
    const [showSecurePassword, setShowSecurePassword] = useState(false);
    const [securePasswordError, setSecurePasswordError] = useState("");
    const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

    const [noteToUnlock, setNoteToUnlock] = useState(null);
    const [unlockedNoteIds, setUnlockedNoteIds] = useState([]);


    // ========== Popup Notes ==========
    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => {
            setPopup({ show: false, type: "", message: "" });
            popupTimeoutRef.current = null;
        }, 3000);
    }, []);

    useEffect(() => {
        return () => { if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current); };
    }, []);

    // ========== Fetch Notes ==========
    const fetchNotes = useCallback(async () => {
        setIsLoadingNotes(true);
        setLoadError("");
        try {
            const result = await getNotes();
            if (!result || result.status < 200 || result.status >= 300) {
                throw new Error(result?.data?.detail || result?.data?.error || result?.data?.message || "Unable to load notes. Please try again.");
            }
            const fetchedNotes = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.results) ? result.data.results : Array.isArray(result.data?.data) ? result.data.data : null;
            if (!fetchedNotes) throw new Error("The server returned an unexpected notes response.");
            setNotes(fetchedNotes);
            const validIds = new Set(fetchedNotes.map((note) => String(note.id)));
            setSelectedNoteIds((current) => current.filter((id) => validIds.has(String(id))));
            return fetchedNotes;
        } catch (error) {
            console.error("Error fetching notes:", error);
            setLoadError(error.message || "Unable to connect to FocusHub. Check your connection and try again.");
            return [];
        } finally {
            setIsLoadingNotes(false);
        }
    }, []);

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    // ========== Notes Directs to Accounts page ==========
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

    // ========== Sorting Notes ==========
    const sortedNotes = useMemo(() => {
        return notes
            .filter((note) => !note.is_archived && !note.is_deleted)
            .sort((a, b) => {
                if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
                if (sortBy === "title-asc") return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
                if (sortBy === "title-desc") return (b.title || "").localeCompare(a.title || "", undefined, { sensitivity: "base" });
                const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
                const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
                return sortBy === "oldest" ? dateA - dateB : dateB - dateA;
            });
    }, [notes, sortBy]);

  // ========== Selecting Notes ==========
    const isNoteSelected = (noteId) => selectedNoteIds.some((id) => String(id) === String(noteId));
    const getSelectedNotes = () => {
        if (selectedNoteIds.length === 0) {
            showPopup("error", "Select at least one note first.");
            return [];
        }
        return sortedNotes.filter((note) => isNoteSelected(note.id));
    };
    const toggleNoteSelection = (event, noteId) => {
        event.stopPropagation();
        setSelectedNoteIds((current) => current.some((selId) => String(selId) === String(noteId)) ? current.filter((selId) => String(selId) !== String(noteId)) : [...current, noteId]);
    };
    const allNotesSelected = sortedNotes.length > 0 && sortedNotes.every((note) => isNoteSelected(note.id));
    const handleToggleSelectAll = () => {
        setSelectedNoteIds((current) => {
            const allSelected = sortedNotes.length > 0 && sortedNotes.every((note) => current.some((id) => String(id) === String(note.id)));
            return allSelected ? [] : sortedNotes.map((note) => note.id);
        });
    };

  // ========== Pin / Unpin Notes ==========
    const pinnedNotes = sortedNotes.filter((note) => note.is_pinned);
    const unpinnedNotes = sortedNotes.filter((note) => !note.is_pinned);
    const handleTogglePin = async (event, note) => {
        event.stopPropagation();
        if (isProcessingAction) return;
        const newPinnedStatus = !note.is_pinned;
        setIsProcessingAction(true);
        setActionNoteId(note.id);
        try {
            const result = await toggleNotePin(note.id, newPinnedStatus);
            if (!result || result.status < 200 || result.status >= 300) {
                throw new Error(result?.data?.detail || result?.data?.error || "Unable to update note pin.");
            }
            await fetchNotes();
            showPopup("success", newPinnedStatus ? "Note pinned." : "Note unpinned.");
        } catch (error) {
            console.error("Error updating note pin:", error);
            showPopup("error", error.message || "Unable to update note pin.");
        } finally {
            setIsProcessingAction(false);
            setActionNoteId(null);
        }
    };

    // ========== Archive Selected Notes ==========
    const handleArchiveSelected = async () => {
        const selectedNotes = getSelectedNotes();
        if (!selectedNotes.length || isProcessingAction) return;
        setIsProcessingAction(true);
        setShowMoreMenu(false);
        try {
            const results = await Promise.allSettled(selectedNotes.map((note) => archiveNote(note.id, true)));
            const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
            await fetchNotes();
            setSelectedNoteIds([]);
            if (failedCount === 0) {
                showPopup("success", "Selected notes archived successfully.");
            } else {
                showPopup("error", `${failedCount} note(s) could not be archived.`);
            }
        } catch (error) {
            console.error("Error archiving notes:", error);
            showPopup("error", "Unable to archive the selected notes.");
        } finally {
            setIsProcessingAction(false);
        }
    };

  // ========== Share Selected Notes ==========
    const handleSendSelected = async () => {
        const selectedNotes = getSelectedNotes();
        if (!selectedNotes.length || isProcessingAction) return;
        if (selectedNotes.some((note) => note.is_locked)) {
            setNoteToUnlock({ action: "send", notes: selectedNotes });
            setSecurePassword("");
            setSecurePasswordError("");
            setShowMoreMenu(false);
            return setShowUnlockPrompt(true);
        }
        await sendSelectedNotes(selectedNotes);
    };
    const sendSelectedNotes = async (selectedNotes) => {
        if (!selectedNotes.length || isProcessingAction) return;
        setIsProcessingAction(true);
        setShowMoreMenu(false);
        try {
            const sharedNotes = [];
            for (const note of selectedNotes) {
                const result = await shareNote(note.id);
                if (!result || result.status < 200 || result.status >= 300) {
                    throw new Error(result?.data?.detail || result?.data?.error || `Unable to prepare "${note.title || "Untitled note"}" for sharing.`);
                }
                const sharedNote = result.data?.data ?? result.data;
                if (!sharedNote) throw new Error("Unable to prepare the selected notes.");
                sharedNotes.push(sharedNote);
            }
            const shareText = sharedNotes.map((note) => `${note.title || "Untitled note"}\n\n${note.is_locked ? "Secured note" : note.content || "No content"}`).join("\n\n--------------------\n\n");
            if (navigator.share) {
                await navigator.share({ title: "FocusHub Notes", text: shareText });
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareText);
                showPopup("success", "Selected notes copied. You can paste them into a sharing app.");
            } else {
                showPopup("error", "Sharing is unavailable in this browser.");
            }
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("Error sharing notes:", error);
                showPopup("error", error.message || "Unable to share the selected notes.");
            }
        } finally {
            setIsProcessingAction(false);
        }
    };

    // ========== Copy Selected Notes ==========
    const handleCopySelected = async () => {
        const selectedNotes = getSelectedNotes();
        if (!selectedNotes.length || isProcessingAction) return;
        if (selectedNotes.some((note) => note.is_locked)) {
            setNoteToUnlock({ action: "copy", notes: selectedNotes });
            setSecurePassword("");
            setSecurePasswordError("");
            return setShowUnlockPrompt(true);
        }
        await copySelectedNotes(selectedNotes);
    };
    const copySelectedNotes = async (selectedNotes) => {
        if (!selectedNotes.length || isProcessingAction) return;
        setIsProcessingAction(true);
        setShowMoreMenu(false);
        try {
            const response = await getNotes();
            if (!response || response.status < 200 || response.status >= 300) {
                throw new Error("Unable to check existing note titles.");
            }
            const data = response.data;
            const latestNotes = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : [];
            const existingTitles = new Set(
                latestNotes.map((item) => String(item.title || "").trim().toLocaleLowerCase()).filter(Boolean)
            );
            let successCount = 0;
            let failedCount = 0;
            for (const note of selectedNotes) {
                const displayedTitle = note.is_locked ? getPrivateNoteTitle(note) : String(note.title || "Untitled note").trim() || "Untitled note";
                const baseTitle = displayedTitle.replace(/\s+copy(?:\(\d+\))?$/i, "").trim() || "Untitled note";
                let copyTitle = `${baseTitle} copy`;
                let copyNumber = 1;
                while (existingTitles.has(copyTitle.toLocaleLowerCase())) {
                    copyTitle = `${baseTitle} copy(${copyNumber})`;
                    copyNumber++;
                }
                const result = await copyNote(note.id, copyTitle);
                if (result && result.status >= 200 && result.status < 300) {
                    successCount++;
                    existingTitles.add(copyTitle.toLocaleLowerCase());
                    const savedTitle = result.data?.note?.title;
                    if (savedTitle) {
                        existingTitles.add(String(savedTitle).trim().toLocaleLowerCase());
                    }
                } else {
                    failedCount++;
                }
            }
            await fetchNotes();
            setSelectedNoteIds([]);
            if (failedCount === 0) {
                showPopup("success", "Selected notes copied.");
            } else if (successCount > 0) {
                showPopup("error", `${successCount} note(s) copied; ${failedCount} failed.`);
            } else {
                showPopup("error", "Unable to copy the selected notes.");
            }
        } catch (error) {
            console.error("Error copying notes:", error);
            showPopup("error", error.message || "Unable to copy the selected notes.");
        } finally {
            setIsProcessingAction(false);
        }
    };

    // ========== Bulk Delete notes ==========
    const confirmBulkDelete = async () => {
        if (selectedNoteIds.length === 0 || isBulkDeleting) return;
        setIsBulkDeleting(true);
        try {
            const results = await Promise.allSettled(selectedNoteIds.map((id) => deleteNote(id)));
            const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
            await fetchNotes();
            setShowBulkDeleteConfirm(false);
            setSelectedNoteIds([]);
            if (failedCount === 0) {
                showPopup("success", "Selected notes moved to Trash.");
            } else {
                showPopup("error", `${failedCount} note(s) could not be moved to Trash.`);
            }
        } catch (error) {
            console.error("Error moving notes to Trash:", error);
            showPopup("error", "Unable to move notes to Trash.");
        } finally {
            setIsBulkDeleting(false);
        }
    };

    // ========== More actions for Note ==========
    useEffect(() => {
        if (selectedNoteIds.length === 0) {
            setShowMoreMenu(false);
        }
    }, [selectedNoteIds]);

    // ========== Create, View, Edit a Note ==========
    const handleCreateNewNote = () => {
        setSelectedNote(null);
        setNoteForm({ ...EMPTY_NOTE });
        setNoteErrors({});
        setIsEditingNote(true);
        setShowNoteForm(true);
    };

    const handleViewNote = (note) => {
        if (note.is_locked) {
            setNoteToUnlock(note);
            setSecurePassword("");
            setSecurePasswordError("");
            setShowUnlockPrompt(true);
            return;
        }
        setSelectedNote(note);
        setNoteForm({
            title: note.title || "",
            content: note.content || "",
            is_locked: Boolean(note.is_locked),
        });
        setNoteErrors({});
        setIsEditingNote(false);
        setShowNoteForm(true);
    };

    const handleVerifyNotePassword = async (event) => {
        event?.preventDefault();
        if (!securePassword.trim() || !noteToUnlock) {
            setSecurePasswordError("Please enter your Card Lock Password.");
            return;
        }
        setIsVerifyingPassword(true);
        setSecurePasswordError("");
        try {
            const verifyResult = await verifyCardLockPassword(securePassword);
            console.log("Note password verification response:", verifyResult);
            if (!verifyResult || verifyResult.status < 200 || verifyResult.status >= 300)  {
                setSecurePasswordError(verifyResult?.data?.error || verifyResult?.data?.message || "Incorrect password.");
                return;
            }
            const pendingAction = noteToUnlock;
            if (pendingAction.action === "copy" || pendingAction.action === "send") {
                setShowUnlockPrompt(false);
                setSecurePassword("");
                setNoteToUnlock(null);
                if (pendingAction.action === "copy") {
                    await copySelectedNotes(pendingAction.notes);
                } else {
                    await sendSelectedNotes(pendingAction.notes);
                }
                return;
            }
            const noteResult = await getNoteById(noteToUnlock.id);
            console.log("Secured note retrieval response:", noteResult);
            if (noteResult.status !== 200 || !noteResult.data) {
                setSecurePasswordError(noteResult.data?.error || "Unable to open this note.");
                return;
            }
            const originalNote = noteResult.data;
            setUnlockedNoteIds((previous) => previous.some((id) => String(id) === String(originalNote.id)) ? previous: [...previous, originalNote.id]);
            setShowUnlockPrompt(false);
            setSecurePassword("");
            setNoteToUnlock(null);
            setSelectedNote(originalNote);
            setNoteForm({
                title: originalNote.title || "",
                content: originalNote.content || "",
                is_locked: Boolean(originalNote.is_locked),
            });
            setNoteErrors({});
            setIsEditingNote(false);
            setShowNoteForm(true);
        } catch (error) {
            console.error("Password verification error:", error);
            setSecurePasswordError("Unable to verify your password. Please try again.");
        } finally {
            setIsVerifyingPassword(false);
        }
    };


    const handleEditNote = () => {
        if (!selectedNote || isSavingNote) return;
        setIsEditingNote(true);
        setNoteErrors({});
    };

    const handleNoteFormChange = (field, value) => {
        setNoteForm((current) => ({ ...current, [field]: value }));
        setNoteErrors((current) => ({ ...current, [field]: "" }));
    };

    const handleClearNoteForm = () => {
        if (isSavingNote) return;
        setNoteForm({ ...EMPTY_NOTE });
        setNoteErrors({});
    };

    const handleCloseNoteForm = () => {
        if (isSavingNote) return;
        setSelectedNote(null);
        setNoteForm({ ...EMPTY_NOTE });
        setNoteErrors({});
        setIsEditingNote(false);
        setShowNoteForm(false);
    };

    // ========== Create, Update, Save a Note ==========
    const handleSaveNote = async (event) => {
        event.preventDefault();
        if (isSavingNote || !isEditingNote) return;
        const nextErrors = {
            title: noteForm.title.trim() ? "" : "Please enter a note title.",
            content: noteForm.content.trim() ? "" : "Please enter note content.",
        };
        setNoteErrors(nextErrors);
        if (Object.values(nextErrors).some((error) => error !== "")) {
            showPopup("error", "Please correct the highlighted fields.");
            return;
        }
        setIsSavingNote(true);
        const payload = {
            ...noteForm,
            title: noteForm.title.trim(),
            content: noteForm.content.trim(),
            is_locked: Boolean(noteForm.is_locked)
        };
        try {
            const result = selectedNote ? await updateNote(selectedNote.id, payload) : await createNote(payload);
        if (!result || result.status < 200 || result.status >= 300) {
            throw new Error( result?.data?.detail || result?.data?.error || result?.data?.message || `Unable to ${selectedNote ? "update" : "create"} note.`);
        }
        await fetchNotes();
        showPopup("success", selectedNote ? "Note updated successfully." : "Note created successfully.");
        setSelectedNote(null);
        setNoteForm({ ...EMPTY_NOTE });
        setNoteErrors({});
        setIsEditingNote(false);
        setShowNoteForm(false);
        } catch (error) {
            console.error("Error saving note:", error);
            showPopup("error",error.message || "Unable to save the note.");
        } finally {
            setIsSavingNote(false);
        }
    };

    // ========== Open Note from Navigation ==========
    useEffect(() => {
        const state = location.state || {};
        const requestedNoteId = state.editNoteId ?? state.noteId;
        const shouldEdit = Boolean(state.openForEdit || state.editNoteId != null);
        const fromArchive = Boolean(state.fromArchive);
        if (requestedNoteId == null || isLoadingNotes || loadError) return;
        let cancelled = false;
        const openSelectedNote = async () => {
            let note = notes.find((item) => String(item.id) === String(requestedNoteId));
            if (!note && fromArchive) {
                try {
                    const response = await getArchivedNotes();
                    if (cancelled) return;
                    if (response?.status >= 200 && response.status < 300) {
                        const resData = response.data;
                        const archivedNotes = Array.isArray(resData) ? resData : Array.isArray(resData?.results) ? resData.results : Array.isArray(resData?.data) ? resData.data : [];
                        note = archivedNotes.find((item) => String(item.id) === String(noteId));
                    }
                } catch (error) {
                    console.error("Error loading archived note:", error);
                }
            }
            if (cancelled) return;
            navigate(location.pathname, { replace: true, state: null });
            if (!note) {
                showPopup("error", "Unable to find the selected note.");
                return;
            }
            if (note.is_locked) {
                showPopup("error", "This note is secured. Unlock it before editing.");
                return;
            }
            if (note.is_locked && shouldEdit) {
                await handleViewNote(note);
                return;
            }
            await handleViewNote(note);
            if (shouldEdit && !note.is_locked && !note.is_archived && !note.is_deleted) setIsEditingNote(true);
        };
        openSelectedNote();
        return () => { cancelled = true; };
    }, [location.state, location.pathname, notes, isLoadingNotes, loadError, navigate, showPopup]);

    // ========== Handling Note Secure ==========
    const handleToggleNoteLock = () => {
        if (noteForm.is_locked) {
            handleNoteFormChange("is_locked", false);
            return;
        }
        if (!cardLockPasswordSet) {
            setShowSecurePrompt(true);
            return;
        }
        handleNoteFormChange("is_locked", true);
    };

    // ========== Secure Note Card Title ==========
    const getPrivateNoteTitle = (note) => {
        const lockedNotes = sortedNotes.filter((item) => item.is_locked).sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateA - dateB || Number(a.id) - Number(b.id);
            });
        const actualTitle = String(note.title || "").trim();
        if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
        const index = lockedNotes.findIndex((item) => String(item.id) === String(note.id));
        return `Private Notes (${index + 1})`;
    };

    // ========== Render Note Card ==========
    const renderNoteCard = (note) => {
        const selected = isNoteSelected(note.id);
        return viewMode === "list" ? (
            <article className={`note-card note-card-list ${note.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={note.id} onClick={() => handleViewNote(note)}>
                <div className="note-list-row">
                    <label className="select-label" title="Select note" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" className="select-checkbox" checked={selected} onChange={(event) => toggleNoteSelection(event, note.id)} aria-label={`Select ${note.title || "untitled note"}`} />
                        <span className="select-checkmark" />
                    </label>
                    <span className="note-list-bullet" aria-hidden="true" />
                    <h3 className="note-list-title" title={note.is_locked ? getPrivateNoteTitle(note) : note.title || "Untitled note"}>{note.is_locked ? getPrivateNoteTitle(note) : note.title || "Untitled note"}</h3>
                    <p className="note-list-content" title={note.is_locked ? "This notes content is secured." : note.content || "No content"}>{note.is_locked ? "This notes content is secured." : note.content || "No content"}</p>
                    <span className="note-list-date">{note.updated_at || note.created_at ? new Date(note.updated_at || note.created_at).toLocaleDateString() : ""}</span>
                    <div className="note-card-icons">
                        <button type="button" className={`common-pin-button ${note.is_pinned ? "pinned" : ""}`} title={note.is_pinned ? "Unpin note" : "Pin note"} aria-label={note.is_pinned ? "Unpin note" : "Pin note"} onClick={(event) => handleTogglePin(event, note)} disabled={isProcessingAction}>
                            <i className={`fa-solid ${actionNoteId === note.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
                        </button>
                        {note.is_locked && <i className="fa-solid fa-lock" title="Secured note" aria-label="Secured note" />}
                    </div>
                </div>
            </article>
        ) : (
            <article className={`note-card ${note.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={note.id} onClick={() => handleViewNote(note)}>
                <div className="note-card-header">
                    <div className="note-card-title-area">
                        <label className="select-label" title="Select note" onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" className="select-checkbox" checked={selected} onChange={(event) => toggleNoteSelection(event, note.id)} aria-label={`Select ${note.title || "untitled note"}`} />
                            <span className="select-checkmark" />
                        </label>
                        <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={note.is_locked ? getPrivateNoteTitle(note) : note.title || "Untitled note"}>{note.is_locked ? getPrivateNoteTitle(note) : note.title || "Untitled note"}</h3>
                    </div>
                    <div className="note-card-icons">
                        <button type="button" className={`common-pin-button ${note.is_pinned ? "pinned" : ""}`} title={note.is_pinned ? "Unpin note" : "Pin note"} aria-label={note.is_pinned ? "Unpin note" : "Pin note"} onClick={(event) => handleTogglePin(event, note)} disabled={isProcessingAction}>
                            <i className={`fa-solid ${actionNoteId === note.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
                        </button>
                        {note.is_locked && <i className="fa-solid fa-lock" title="Secured note" aria-label="Secured note" />}
                    </div>
                </div>
                <p className="note-card-content" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden", overflowWrap: "anywhere", minHeight: "4.5em", flex: "0 0 auto" }}>
                    {note.is_locked ? "This notes content is secured." : note.content || "No content"}
                </p>
                <div className="note-card-footer" style={{ marginTop: "auto" }}>
                    <span>{note.updated_at || note.created_at ? new Date(note.updated_at || note.created_at).toLocaleDateString() : ""}</span>
                </div>
            </article>
        )
    };

    // ========== Render Note Section ==========
    const renderNoteSection = (sectionNotes, sectionTitle) => (
        <section className="common-group" key={sectionTitle}>
            <div className="common-group-heading">
                <h2><i className={sectionTitle === "Pinned" ? "fa-solid fa-thumbtack" : "fa-regular fa-note-sticky"} />{sectionTitle}</h2>
                <span>{sectionNotes.length}</span>
            </div>
            <div className={`notes-grid ${viewMode === "list" ? "notes-list" : ""}`}>{sectionNotes.map(renderNoteCard)}</div>
        </section>
    );

    // ========== Loading State ==========
    if (isLoadingNotes) return <Loader message="Loading your notes..." />;
    if (loadError) {
        return (
            <div className="common-page">
                <div className="common-error-state" role="alert">
                    <i className="fa-solid fa-cloud-bolt" />
                    <h2>Unable to load notes</h2>
                    <p>{loadError}</p>
                    <button type="button" className="common-create-button" onClick={fetchNotes}><i className="fa-solid fa-rotate-right" />Retry</button>
                    <button type="button" className="common-error-back-button" onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
                </div>
            </div>
        );
    }

    // ========== Main Notes Page ==========
    return (
        <main className="common-page">
            <header className="common-header">
                <div className="common-header-left">
                    <button type="button" className="common-back-button" onClick={() => navigate("/dashboard")} title="Back to dashboard" aria-label="Back to dashboard">
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <h1>Notes</h1>
                </div>
                <button type="button" className="common-create-button" onClick={handleCreateNewNote}>
                    <i className="fa-solid fa-plus" /><span>New Note</span>
                </button>
            </header>
            <section className="common-content">
                {sortedNotes.length > 0 && (
                    <div className="common-toolbar">
                        <div className="common-toolbar-left">
                            <label className="common-sort-label">
                                <i className="fa-solid fa-arrow-down-wide-short" />
                                <select className="common-sort-select" value={sortBy} onChange={(event) =>setSortBy(event.target.value)} aria-label="Sort notes">
                                    <option value="newest">Newest first</option>
                                    <option value="oldest">Oldest first</option>
                                    <option value="title-asc">Title A - Z</option>
                                    <option value="title-desc">Title Z - A</option>
                                </select>
                            </label>
                            <span className="common-count">{sortedNotes.length}{" "}{sortedNotes.length === 1 ? "note" : "notes"}</span>
                            <button type="button" className="common-select-all-button" onClick={handleToggleSelectAll} aria-pressed={allNotesSelected}>{allNotesSelected ? "Deselect all" : "Select all"}</button>
                        </div>
                        <div className="common-toolbar-right">
                            {selectedNoteIds.length > 0 && (
                                <>
                                    <span className="common-selection-count">{selectedNoteIds.length} selected</span>
                                    <button type="button" className="common-bulk-delete-button" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting || isProcessingAction}>
                                        <i className="fa-regular fa-trash-can" /><span>Move to Trash</span>
                                    </button>
                                </>
                            )}
                            <div className="common-toolbar-actions">
                                <div className="common-view-toggle" aria-label="Note view">
                                    <button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="Grid view" aria-label="Grid view" aria-pressed={viewMode === "grid"}>
                                        <i className="fa-solid fa-grip" />
                                    </button>
                                    <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="List view" aria-label="List view" aria-pressed={viewMode === "list"}>
                                        <i className="fa-solid fa-list" />
                                    </button>
                                </div>
                                {selectedNoteIds.length > 0 && (
                                    <div className="common-more-container">
                                        <button type="button" className="common-more-button" title="More actions" aria-label="More note actions" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu((previous) => !previous)}>
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
                {sortedNotes.length === 0 ? (
                    <div className="common-empty">
                        <i className="fa-regular fa-note-sticky" />
                        <h2>No notes yet</h2>
                        <p>Create your first note to get started.</p>
                    </div>
                    ) : (
                    <div className="common-sections">
                        {pinnedNotes.length > 0 && renderNoteSection(pinnedNotes, "Pinned")}
                        {pinnedNotes.length > 0 && unpinnedNotes.length > 0 && (<div className="common-section-divider"><span /></div>)}
                        {unpinnedNotes.length > 0 && renderNoteSection(unpinnedNotes, "Others")}
                    </div>
                )}
            </section>

            {/* Create, view, or edit note modal */}
            {showNoteForm && (
                <div className="note-form-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingNote) handleCloseNoteForm(); }}>
                    <form className="note-form" role="dialog" aria-modal="true" aria-labelledby="note-form-title" onSubmit={handleSaveNote}>
                        <div className="note-form-header">
                            <div>
                                <h2 id="note-form-title">{selectedNote ? (isEditingNote ? "Edit Note" : "View Note") : "Create Note"}</h2>
                                <p>{selectedNote ? (isEditingNote ? "Update your note details." : "View your note information.") : "Write and save your note."}</p>
                            </div>
                            <div className="note-form-header-actions">
                                {selectedNote && !isEditingNote && (
                                    <button type="button" className="edit-icon-button" onClick={handleEditNote} title="Edit note" aria-label="Edit note">
                                        <i className="fa-solid fa-pen" />
                                    </button>
                                )}
                                {isEditingNote && (
                                    <button type="button" className={`lock-button ${noteForm.is_locked ? "locked" : ""}`} onClick={handleToggleNoteLock} disabled={isSavingNote} aria-pressed={noteForm.is_locked}>
                                        <i className={noteForm.is_locked ? "fa-solid fa-lock" : "fa-solid fa-lock-open"} />
                                        <span>{noteForm.is_locked ? "Secured" : "Open"}</span>
                                    </button>
                                )}
                                <button type="button" className="close-icon-button" onClick={handleCloseNoteForm} aria-label="Close note form" disabled={isSavingNote}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>
                        <div className="note-form-body">
                            <div className="note-field">
                                <label className="note-title" htmlFor="note-title">Title</label>
                                <input id="note-title" type="text" placeholder="Note title" className={`note-title-input ${noteErrors.title ? "input-error" : ""}`} value={noteForm.title} readOnly={!isEditingNote} onChange={(e) => handleNoteFormChange("title", e.target.value)} aria-invalid={Boolean(noteErrors.title)} aria-describedby={noteErrors.title ? "note-title-error" : undefined} />
                                {isEditingNote && noteErrors.title && (<p id="note-title-error" className="note-field-error" role="alert">{noteErrors.title}</p>)}
                            </div>
                            <div className="note-field">
                                <label className="note-content" htmlFor="note-content">Content</label>
                                <textarea id="note-content" placeholder="Write your note..." className={`note-content-input ${noteErrors.content ? "input-error" : ""}`} value={noteForm.content} readOnly={!isEditingNote} onChange={(e) => handleNoteFormChange("content", e.target.value)} aria-invalid={Boolean(noteErrors.content)} aria-describedby={noteErrors.content ? "note-content-error" : undefined} />
                                {isEditingNote && noteErrors.content && (<p id="note-content-error" className="note-field-error" role="alert">{noteErrors.content}</p>)}
                            </div>
                            {noteForm.is_locked && (<p className="locked-message"><i className="fa-solid fa-lock" /> This note is marked as secured.</p>)}
                        </div>
                        <div className="form-actions">
                            {isEditingNote ? (
                                <>
                                    <button type="button" className="clear-button" onClick={handleClearNoteForm} disabled={isSavingNote}>
                                        <i className="fa-solid fa-eraser" /><span>Clear</span>
                                    </button>
                                    <button type="button" className="cancel-button" onClick={handleCloseNoteForm} disabled={isSavingNote}>
                                        <i className="fa-solid fa-ban"></i><span>Cancel</span>
                                    </button>
                                    <button type="submit" className="save-button" disabled={isSavingNote || !noteForm.title.trim()}>
                                        <i className={`fa-solid ${isSavingNote ? "fa-spinner fa-spin" : "fa-check"}`} />
                                        <span>{isSavingNote ? "Saving..." : selectedNote ? "Save Changes" : "Save Note"}</span>
                                    </button>
                                </>
                            ) : (
                                <button type="button" className="cancel-button" onClick={handleCloseNoteForm} disabled={isSavingNote}>
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
                        <p>First add a Card Lock Password, then come back to secure your note.</p>
                        <div className="modal-actions">
                            <button type="button" className="save-button" onClick={() => {navigate("/account", {state: { focusCardLockPassword: true },});}}>Add Password</button>
                            <button type="button" className="cancel-button" onClick={() => setShowSecurePrompt(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Unlock Secured Note */}
            {showUnlockPrompt && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isVerifyingPassword) { setShowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setNoteToUnlock(null); setShowSecurePassword(false); } }}>
                    <form className="modal-content secure-password-prompt" role="dialog" aria-modal="true" aria-labelledby="unlock-note-title" onSubmit={handleVerifyNotePassword}>
                        <h2 id="unlock-note-title">{noteToUnlock?.action === "copy" ? "Verify Password to Copy" : noteToUnlock?.action === "send" ? "Verify Password to Send" : "Unlock Private Note"}</h2>
                        <p>{noteToUnlock?.action === "copy" ? "Enter your Card Lock Password to copy the selected secured notes." : noteToUnlock?.action === "send" ? "Enter your Card Lock Password to send the selected secured notes." : "Enter your Card Lock Password to view this note."}</p>
                        <div className="note-field">
                            <label htmlFor="unlock-note-password">Card Lock Password</label>
                            <div className="password-input-wrapper">
                                <input id="unlock-note-password" type={showSecurePassword ? "text" : "password"} value={securePassword} onChange={(e) => { setSecurePassword(e.target.value); setSecurePasswordError(""); }} placeholder="Enter your password" autoComplete="current-password" autoFocus disabled={isVerifyingPassword} />
                                <button type="button" className="password-toggle-button" onClick={() => setShowSecurePassword((prev) => !prev)} aria-label={showSecurePassword ? "Hide password" : "Show password"} title={showSecurePassword ? "Hide password" : "Show password"} disabled={isVerifyingPassword}>
                                    <i className={showSecurePassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        {securePasswordError && <p className="note-field-error" role="alert">{securePasswordError}</p>}
                        <div className="modal-actions">
                            <button type="button" className="cancel-button" onClick={() => { setShowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setNoteToUnlock(null); setShowSecurePassword(false); }} disabled={isVerifyingPassword}>Cancel</button>
                            <button type="submit" className="save-button" disabled={isVerifyingPassword || !securePassword.trim()}>{isVerifyingPassword ? "Verifying..." : noteToUnlock?.action === "copy" ? "Verify & Copy" : noteToUnlock?.action === "send" ? "Verify & Send" : "Unlock Note"}</button>
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

            {/* Bulk delete confirmation */}
            {showBulkDeleteConfirm && (
                <div className="delete-confirm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBulkDeleting) setShowBulkDeleteConfirm(false); }}>
                    <div className="delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
                        <div className="delete-confirm-icon">
                            <i className="fa-regular fa-trash-can" />
                        </div>
                        <h3 id="bulk-delete-title">Move selected notes to Trash?</h3>
                        <p>You are about to move <strong>{selectedNoteIds.length} {selectedNoteIds.length === 1 ? "note" : "notes"}</strong> to Trash. You can restore them later from the Trash page.</p>
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

export default Notes;