import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getArchivedNotes, archiveNote } from "../services/noteService";
import { getArchivedLists, archiveList } from "../services/listService";
import { getArchivedTasks, archiveTask } from "../services/taskService";
import Loader from "../components/Loader";

const EMPTY_SELECTION = { notes: [], lists: [], tasks: [] };

const SECTION_CONFIG = [
    {
        key: "notes",
        label: "Notes",
        icon: "fa-solid fa-note-sticky",
        emptyMessage: "No notes archived.",
    },
    {
        key: "lists",
        label: "Lists",
        icon: "fa-solid fa-list-check",
        emptyMessage: "No lists archived.",
    },
    {
        key: "tasks",
        label: "Tasks",
        icon: "fa-solid fa-list",
        emptyMessage: "No tasks archived.",
    },
];

const RESTORE_FUNCTIONS = {
    notes: (id) => archiveNote(id, false),
    lists: (id) => archiveList(id, false),
    tasks: (id) => archiveTask(id, false),
};

const isSuccessful = (response) => response?.status >= 200 && response?.status < 300;

const getResponseItems = (response) => {
    if (!isSuccessful(response)) return [];
    if (Array.isArray(response.data)) {
        return response.data;
    }
    if (Array.isArray(response.data?.results)) {
        return response.data.results;
    }
    return [];
};


const getItemTitle = (section, item, archivedNotes = [], archivedLists = [], archivedTasks = []) => {
    if (!item) return "";
    if (section === "notes") {
        if (item.is_locked) {
            const actualTitle = String(item.title || "").trim();
            if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
            const lockedNotes = archivedNotes.filter((note) => note.is_locked).sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateA - dateB || Number(a.id) - Number(b.id);
            });
            const index = lockedNotes.findIndex((note) => String(note.id) === String(item.id));
            return index >= 0 ? `Private Notes (${index + 1})` : actualTitle || "Private Notes";
        }
        return item.title || "Untitled";
    }

    if (section === "lists") {
        if (item.is_locked) {
            const actualTitle = String(item.title || item.name || "").trim();
            if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
            const lockedLists = archivedLists.filter((list) => list.is_locked).sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateA - dateB || Number(a.id) - Number(b.id);
            });
            const index = lockedLists.findIndex((list) => String(list.id) === String(item.id));
            return index >= 0 ? `Private Lists (${index + 1})` : actualTitle || "Private Lists";
        }
        return item.title || item.name || "Untitled";
    }

    if (section === "tasks") {
        if (item.is_locked) {
            const actualTitle = String(item.title || "").trim();
            if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
            const lockedTasks = archivedTasks.filter((task) => task.is_locked).sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateA - dateB || Number(a.id) - Number(b.id);
            });
            const index = lockedTasks.findIndex((task) => String(task.id) === String(item.id));
            return index >= 0 ? `Private Tasks (${index + 1})` : actualTitle || "Private Tasks";
        }
        return item.title || "Untitled task";
    }
    return item.title || item.name || "Untitled";
};

const getItemPreview = (section, item) => {
    if (section === "notes") return item.is_locked ? "Secured note" : item.content || "No content";
    if (section === "lists") {
        if (item.is_locked) return "Secured list";
        if (Array.isArray(item.items)) return item.items.length ? `${item.items.length} items · ${item.items.filter((li) => listItem.is_completed).length} completed` : "No list items";
        return item.description || "Click to view this list";
    }
    if (section === "tasks") return item.is_locked ? "Secured task" : item.description || "No description";
    return item.description || "No preview available";
};

const getUpdatedDate = (item) => item.updated_at || item.created_at || null;

const formatDate = (date) => {
    if (!date) return "Date unavailable"
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return "Date unavailable";
    }
    return parsed.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
};

const formatDateTime = (date) => {
    if (!date) return "Date unavailable";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return "Date unavailable";
    }
    return parsed.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

function Archive() {
    const navigate = useNavigate();
    const location = useLocation();
    const [notes, setNotes] = useState([]);
    const [lists, setLists] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [selected, setSelected] = useState(EMPTY_SELECTION);
    const [loading, setLoading] = useState(true);
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState("");
    const [popup, setPopup] = useState(null);
    const [preview, setPreview] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortOrder, setSortOrder] = useState("newest");
    const showPopup = useCallback((type, message) => {setPopup({ type, message });},[]);

    const fetchArchivedItems = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const responses = await Promise.all([
                getArchivedNotes(),
                getArchivedLists(),
                getArchivedTasks(),
            ]);
            const [noteResponse, listResponse, taskResponse] = responses;
            const responseGroups = [
                { response: noteResponse, label: "notes" },
                { response: listResponse, label: "lists" },
                { response: taskResponse, label: "tasks" },
            ];
            const failedGroups = responseGroups.filter(({ response }) => !isSuccessful(response));
            setNotes(getResponseItems(noteResponse));
            setLists(getResponseItems(listResponse));
            setTasks(getResponseItems(taskResponse));
            setSelected({ ...EMPTY_SELECTION });
            if (failedGroups.length > 0) {
                setError(`Unable to load archived ${failedGroups.map(({ label }) => label).join(", ")}. You can refresh and try again.`);
            }
        } catch (requestError) {
            console.error("Error loading archive:", requestError);
            setError("Unable to connect to the FocusHub server. Check your connection and refresh.");
        } finally {
            setLoading(false);
        }
    },[]);

    useEffect(() => {
        fetchArchivedItems();
    },[fetchArchivedItems]);

    useEffect(() => {
        if (!popup) return undefined;
        const timer = setTimeout(() => {
            setPopup(null);
        }, 3500);
        return () => clearTimeout(timer);
    }, [popup]);

    useEffect(() => {
        if (!preview) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                setPreview(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [preview]);

    const sections = useMemo(
        () => [
            { ...SECTION_CONFIG[0], items: notes },
            { ...SECTION_CONFIG[1], items: lists },
            { ...SECTION_CONFIG[2], items: tasks },
        ],
        [notes, lists, tasks]
    );

    const totalArchived = notes.length + lists.length + tasks.length;

    const getFilteredItems = useCallback((section, items) => {
        const query = searchTerm.trim().toLowerCase();
        const filteredItems = items.filter((item) => {
            if (!query) return true;
            const title = getItemTitle(section, item, notes, lists, tasks), previewText = getItemPreview(section, item);
            if (section === "tasks" && item.is_locked) return `${title} ${previewText}`.toLowerCase().includes(query);

            const extraText = section === "tasks"
                ? `${item.priority || ""} ${item.status || ""} ${typeof item.assigned_to === "object" ? "" : item.assigned_to || ""}`
                : section === "lists" && !item.is_locked && Array.isArray(item.items)
                    ? item.items.map((li) => li.text || li.title || "").join(" ") : "";

            return `${title} ${previewText} ${extraText}`.toLowerCase().includes(query);
        });

        return [...filteredItems].sort((a, b) => {
            const dateA = new Date(getUpdatedDate(a) || 0).getTime(), dateB = new Date(getUpdatedDate(b) || 0).getTime();
            return sortOrder === "oldest" ? dateA - dateB : dateB - dateA;
        });
    }, [searchTerm, sortOrder, notes, lists, tasks]);

    const updateSelection = (section, id) => {
        setSelected((previous) => {
            const alreadySelected = previous[section].some(
                (selectedId) => String(selectedId) === String(id)
            );
            return {
                ...previous,
                [section]: alreadySelected
                    ? previous[section].filter(
                          (selectedId) => String(selectedId) !== String(id)
                      )
                    : [...previous[section], id],
            };
        });
    };

    const selectAll = (section, items) => {
        const ids = items.map((item) => item.id);
        const allSelected =
            ids.length > 0 &&
            ids.every((id) =>
                selected[section].some(
                    (selectedId) => String(selectedId) === String(id)
                )
            );
        setSelected((previous) => ({
            ...previous,
            [section]: allSelected ? [] : ids,
        }));
    };

    const removeRestoredItems = (section, restoredIds) => {
        const restoredIdSet = new Set(restoredIds.map(String));
        const setters = {
            notes: setNotes,
            lists: setLists,
            tasks: setTasks,
        };
        setters[section]((previous) =>
            previous.filter((item) => !restoredIdSet.has(String(item.id)))
        );
        setSelected((previous) => ({
            ...previous,
            [section]: previous[section].filter(
                (id) => !restoredIdSet.has(String(id))
            ),
        }));
        setPreview((previous) =>previous && previous.section === section && restoredIdSet.has(String(previous.item.id)) ? null : previous);
    };

    const restoreSection = async (section) => {
        const ids = [...selected[section]];
        if (!ids.length || restoring) return;
        setRestoring(true);
        setPopup(null);
        try {
            const results = await Promise.allSettled(
                ids.map((id) => RESTORE_FUNCTIONS[section](id))
            );
            const restoredIds = [];
            let failedCount = 0;
            results.forEach((result, index) => {
                if (
                    result.status === "fulfilled" &&
                    isSuccessful(result.value)
                ) {
                    restoredIds.push(ids[index]);
                } else {
                    failedCount += 1;
                }
            });
            if (restoredIds.length > 0) {
                removeRestoredItems(section, restoredIds);
            }
            if (restoredIds.length > 0 && failedCount === 0) {
                showPopup("success",`${restoredIds.length} item(s) restored successfully.`);
            } else if (restoredIds.length > 0) {
                showPopup("error",`${restoredIds.length} restored; ${failedCount} could not be restored.`);
            } else {
                showPopup("error",`Unable to restore the selected ${section}.`);
            }
        } catch (requestError) {
            console.error("Error restoring items:", requestError);
            showPopup("error","Unable to connect to the FocusHub server.");
        } finally {
            setRestoring(false);
        }
    };

    const restoreSingleItem = async (section, item) => {
        if (restoring) return;
        setRestoring(true);
        setPopup(null);
        try {
            const response = await RESTORE_FUNCTIONS[section](item.id);
            if (isSuccessful(response)) {
                removeRestoredItems(section, [item.id]);
                showPopup("success", "Item restored successfully.");
            } else {
                showPopup("error",response.data?.error || "Unable to restore this item."
                );
            }
        } catch (requestError) {
            console.error("Error restoring item:", requestError);
            showPopup("error","Unable to connect to the FocusHub server."
            );
        } finally {
            setRestoring(false);
        }
    };

    const openPreview = (section, item) => {setPreview({ section, item });};

    // ========== Editing Archive ==========
    const editArchivedNote = () => {
        if (!preview || preview.section !== "notes") return;
        if (preview.item.is_locked) {
            showPopup("error","Unlock the secured note before editing.");
            return;
        }
        navigate("/notes", {
            state: {
                noteId: preview.item.id,
                openForEdit: true,
                fromArchive: true,
            },
        });
    };

    const editArchivedList = () => {
        if (!preview || preview.section !== "lists") return;
        navigate("/lists", {
            state: {
                listId: preview.item.id,
                openForEdit: true,
                fromArchive: true,
            },
        });
    };

    const editArchivedTask = () => {
        if (!preview || preview.section !== "tasks") return;
        navigate("/tasks", {
            state: {
                taskId: preview.item.id,
                openTaskView: true,
                fromArchive: true,
            },
        });
    };

    // ========== Rendering Archive ==========
    const renderTaskDetails = (task) => (
        <div className="archive-task-details">
            <span><i className="fa-solid fa-flag" /> Priority: {task.priority || "Not set"}</span>
            <span><i className="fa-solid fa-list-check" /> Task status: {(task.status || "Not set").replaceAll("_", " ")}</span>
            {task.assigned_to && (
                <span>
                    <i className="fa-solid fa-user" /> Assigned to: {typeof task.assigned_to === "object" ? task.assigned_to.username || task.assigned_to.name || "Assigned" : task.assigned_to}
                </span>
            )}
            {task.due_date && <span><i className="fa-regular fa-calendar" /> Due: {formatDate(task.due_date)}</span>}
        </div>
    );

    // ========== Loading Archive ==========
    if (loading) return <Loader message="Loading your archive..." />;

    // ========== Main Archive ==========
    return (
        <main className="common-page">
            <header className="common-header">
                <div className="common-header-left">
                    <button type="button" className="common-back-button" onClick={() => navigate("/dashboard")} aria-label="Back to dashboard" title="Back to dashboard">
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <h1><i className="fa-solid fa-box-archive"/> Archive</h1>
                </div>
                <button type="button" className="common-create-button" onClick={fetchArchivedItems} disabled={loading || restoring}>
                    <i className={loading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-rotate"} /> Refresh
                </button>
            </header>
            <section className="common-content">
                <div className="archive-intro">
                    <div>
                        <h2>Your archived items</h2>
                        <p>Keep inactive notes, lists, and tasks here until you need them again.</p>
                    </div>
                    <span className="archive-total-count"><i className="fa-solid fa-box-archive" /> {totalArchived} total items</span>
                </div>
                <div className="archive-summary">
                    {sections.map((section) => (
                        <div className="archive-summary-card" key={section.key}>
                            <div className="archive-summary-icon"><i className={section.icon} /></div>
                            <div>
                                <span>{section.label}</span>
                                <strong>{section.items.length}</strong>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="common-toolbar">
                    <label className="archive-search">
                        <i className="fa-solid fa-magnifying-glass" />
                        <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search archived items..." aria-label="Search archived items" />
                        {searchTerm && <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear search"><i className="fa-solid fa-xmark" /></button>}
                    </label>
                    <label className="archive-sort">
                        <span>Sort by</span>
                        <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort archived items">
                            <option value="newest">Recently updated</option>
                            <option value="oldest">Oldest updated</option>
                        </select>
                    </label>
                </div>

                {error && (
                    <div className="archive-error-message" role="alert">
                        <i className="fa-solid fa-circle-exclamation" />
                        <span>{error}</span>
                        <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
                            <i className="fa-solid fa-xmark" />
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="archive-message"><i className="fa-solid fa-spinner fa-spin" />Loading archive...</div>
                ) : (
                    <div className="archive-sections">
                        {sections.map((section) => {
                            const visibleItems = getFilteredItems(section.key,section.items);
                            const selectedIds = selected[section.key];
                            const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.some((id) => String(id) === String(item.id)));
                            return (
                                <section className="archive-section" key={section.key}>
                                    <div className="archive-section-header">
                                        <h2>
                                            <i className={section.icon} /> {section.label}
                                            <span className="archive-section-count">{section.items.length}</span>
                                        </h2>
                                        {section.items.length > 0 && (
                                            <button type="button" className="archive-restore-button" disabled={selectedIds.length === 0 || restoring} onClick={() => restoreSection(section.key)}>
                                                <i className={restoring ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-box-open"} /> Restore selected ({selectedIds.length})
                                            </button>
                                        )}
                                    </div>
                                    {section.items.length === 0 ? (
                                        <div className="archive-empty-section"><i className="fa-regular fa-folder-open" /><span>{section.emptyMessage}</span></div>
                                    ) : visibleItems.length === 0 ? (
                                        <div className="archive-empty-section"><i className="fa-solid fa-magnifying-glass" />
                                            <span>No {section.label.toLowerCase()}{" "}match your search.</span>
                                        </div>
                                    ) : (
                                        <div className="archive-list-container">
                                            <table className="archive-list-table">
                                                <thead>
                                                    <tr>
                                                        <th className="archive-checkbox-column">
                                                            <input type="checkbox" checked={allVisibleSelected} onChange={() => selectAll(section.key, visibleItems)} disabled={restoring} aria-label={`Select all visible archived ${section.key}`} />
                                                        </th>
                                                        <th>{section.label}</th>
                                                        <th>Last updated</th>
                                                        <th>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {visibleItems.map((item) => {
                                                        const isSelected = selectedIds.some((id) => String(id) === String(item.id));
                                                        return (
                                                            <tr key={item.id} className={isSelected ? "archive-list-row selected" : "archive-list-row"}>
                                                                <td className="archive-checkbox-column">
                                                                    <input type="checkbox" checked={isSelected} onChange={() => updateSelection(section.key, item.id)} disabled={restoring} aria-label={`Select ${getItemTitle(section.key, item)}`} />
                                                                </td>
                                                                <td className="archive-item-info">
                                                                    <button type="button" className="archive-item-title" onClick={() => openPreview(section.key, item)}>{getItemTitle(section.key, item, notes, lists, tasks)}</button>
                                                                    <p className="archive-item-preview">{getItemPreview(section.key, item)}</p>
                                                                </td>
                                                                <td>{formatDate(getUpdatedDate(item))}</td>
                                                                <td><span className="archive-status"><i className="fa-solid fa-box-archive" /> Archived</span></td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                )}
            </section>

            {preview && (
                <div className="archive-preview-overlay" onClick={() => setPreview(null)}>
                    <section className="archive-preview-modal" role="dialog" aria-modal="true" aria-labelledby="archive-preview-title" onClick={(event) => event.stopPropagation()}>
                        <header className="archive-preview-header">
                            <div>
                                <span className="archive-preview-type">Archived {preview.section === "notes" ? "Note" : preview.section === "lists" ? "List" : "Task"}</span>
                                <h2 id="archive-preview-title">{getItemTitle(preview.section, preview.item, notes, lists, tasks)}</h2>
                            </div>
                            <div className="archive-preview-actions">
                                {preview.section === "notes" && (
                                    <button type="button" title={preview.item.is_locked ? "Unlock this note before editing" : "Edit note"} aria-label="Edit archived note" disabled={Boolean(preview.item.is_locked)} onClick={editArchivedNote}>
                                        <i className="fa-solid fa-pen" />
                                    </button>
                                )}
                                {preview.section === "lists" && (
                                    <button type="button" title="Edit list" aria-label="Edit archived list" onClick={editArchivedList}><i className="fa-solid fa-pen" /></button>
                                )}
                                {preview.section === "tasks" && !preview.item.is_locked && (
                                    <button type="button" title="Edit task" aria-label="Edit archived task" onClick={editArchivedTask}><i className="fa-solid fa-pen" /></button>
                                )}
                                <button type="button" title="Close preview" aria-label="Close preview" onClick={() => setPreview(null)}><i className="fa-solid fa-xmark" /></button>
                            </div>
                        </header>
                        <div className="archive-preview-divider" />
                        <div className="archive-preview-content">
                            {preview.section === "notes" ? (
                                preview.item.is_locked ? (
                                    <p><i className="fa-solid fa-lock" /> This is a secured note. Unlock it before viewing its content.</p>
                                ) : (
                                    preview.item.content || "No content"
                                )
                            ) : preview.section === "lists" ? (
                                preview.item.is_locked ? (
                                    <p><i className="fa-solid fa-lock" /> This is a secured list. Open it in Lists to unlock and view its lists.</p>
                                ) : (
                                    Array.isArray(preview.item.items) && preview.item.items.length > 0 ? (
                                        <>
                                            <p className="archive-list-progress">{preview.item.items.filter((item) => item.is_completed).length} of {preview.item.items.length} items completed</p>
                                            <ul className="archive-preview-list-items">
                                                {preview.item.items.map((li, idx) => (
                                                    <li key={li.id ?? `${preview.item.id}-${idx}`}>
                                                        <i className={li.is_completed ? "fa-solid fa-circle-check" : "fa-regular fa-circle"} />
                                                        <span className={li.is_completed ? "archive-list-item-completed" : ""}>{li.text || li.title || "Untitled item"}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    ) : (
                                        preview.item.description || "No list items"
                                    )
                                )
                            ) : preview.section === "tasks" && preview.item.is_locked ? (
                                <p>
                                    <i className="fa-solid fa-lock" />
                                    This is a secured task. Open it in Tasks to unlock and view its tasks.
                                </p>
                            ) : (
                                <>
                                    <p>{preview.item.description || "No description"}</p>
                                    {renderTaskDetails(preview.item)}
                                </>
                            )}
                        </div>
                        <footer className="archive-preview-footer">
                            <span>Updated: {formatDateTime(getUpdatedDate(preview.item))}</span>
                            <button type="button" className="archive-restore-button" disabled={restoring} onClick={() => restoreSingleItem(preview.section, preview.item)}>
                                <i className={restoring ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-box-open"} /> Restore
                            </button>
                        </footer>
                    </section>
                </div>
            )}

            {/* Popup Modal */}
            {popup && (
                <div className={`focus-popup ${popup.type}`} role={popup.type === "error" ? "alert" : "status"}>
                    <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
                    <span>{popup.message}</span>
                </div>
            )}
        </main>
    );
};

export default Archive;