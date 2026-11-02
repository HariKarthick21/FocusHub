import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getNotes } from "../services/noteService";
import { getLists, getListItems as fetchListItems, updateListItem } from "../services/listService";
import { getTasks, updateTask } from "../services/taskService";
import { logoutUser } from "../services/authService";
import focusHubLogo from "../assets/FocusHub.png";
import Loader from "../components/Loader";

// ==================== HELPERS ====================
const getListTitle = (list) => list?.title || list?.name || list?.list_title || "Untitled list";
const getListItems = (list) => {
    const items = list?.items ?? list?.checklist_items ?? [];
    return Array.isArray(items) ? items : [];
};
const isItemCompleted = (item) => Boolean(item?.is_completed ?? item?.completed ?? item?.isCompleted);
const getItemText = (item) => item?.text || item?.title || "Untitled item";
const getCollection = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.lists)) return data.lists;
    if (Array.isArray(data?.items)) return data.items;
    return null;
};
const isSuccessful = (response) =>response?.status >= 200 && response?.status < 300;
const formatTaskValue = (value) => {
    if (typeof value !== "string" || !value.trim()) {
        return "Not specified";
    }
    return value
        .replaceAll("_", " ")
        .replace(/^./, (char) => char.toUpperCase());
};
const formatTaskDate = (date) => {
    if (!date) return "Not Fixed";
    const parsedDate = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
        return date;
    }
    return parsedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric"});
};

function Dashboard() {
    const navigate = useNavigate();

    // ==================== GENERAL STATE ====================
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [activeFilter, setActiveFilter] = useState("All");
    const [searchQuery, setSearchQuery] = useState("");
    const [showSidebar, setShowSidebar] = useState(false);

    // ==================== NOTES STATE ====================
    const [notes, setNotes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [previewNote, setPreviewNote] = useState(null);

    // ==================== LISTS STATE ====================
    const [lists, setLists] = useState([]);
    const [listsError, setListsError] = useState("");
    const [previewList, setPreviewList] = useState(null);
    const [listActionError, setListActionError] = useState("");
    const [savingItemId, setSavingItemId] = useState(null);

    // ==================== TASKS STATE ====================
    const [tasks, setTasks] = useState([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isUpdatingTask, setIsUpdatingTask] = useState(false);
    const [taskError, setTaskError] = useState("");
    const [taskActionError, setTaskActionError] = useState("");

    const filters = ["All", "Notes", "Lists", "Tasks"];

    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState("");

    // ==================== FETCH NOTES , LISTS, TASKS ====================
    const fetchNotes = useCallback(async () => {
        try {
            setIsLoading(true);
            setLoadError("");
            const response = await getNotes();
            if (!isSuccessful(response)) {
                setLoadError(response?.data?.error || "Unable to load notes. Please try again.");
                return;
            }
            const savedNotes = Array.isArray(response.data) ? response.data : response.data?.results;
            if (!Array.isArray(savedNotes)) {
                setNotes([]);
                setLoadError("The server returned an unexpected notes response.");
                return;
            }
            setNotes(savedNotes);
        } catch (error) {
            console.error("Error fetching dashboard notes:", error);
            setLoadError("Could not connect to the server.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    const fetchLists = useCallback(async () => {
        try {
            setListsError("");
            const response = await getLists();
            if (!isSuccessful(response)) {
                setListsError(response?.data?.error || "Unable to load lists. Please try again.");
                return;
            }
            const savedLists = getCollection(response.data);
            if (!savedLists) {
                setListsError("The server returned an unexpected list response.");
                return;
            }
            const listsWithItems = await Promise.all(
                savedLists.map(async (list) => {
                    const existingItems = list?.items ?? list?.checklist_items;
                    if (Array.isArray(existingItems)) return { ...list, items: existingItems };
                    if (!list?.id) return { ...list, items: [] };
                    try {
                        const itemsResponse = await fetchListItems(list.id);
                        if (!isSuccessful(itemsResponse)) return { ...list, items: [] };
                        return { ...list, items: getCollection(itemsResponse.data) || [] };
                    } catch (error) {
                        console.error(`Error fetching items for list ${list.id}:`, error);
                        return { ...list, items: [] };
                    }
                })
            );
            setLists(listsWithItems);
            setPreviewList((current) => current ? listsWithItems.find((l) => String(l.id) === String(current.id)) || current : null);
        } catch (error) {
            console.error("Error fetching dashboard lists:", error);
            setListsError("Could not load your lists.");
        }
    }, []);

    useEffect(() => {
        fetchLists();
    }, [fetchLists]);

    const fetchTasks = useCallback(async () => {
        setTasksLoading(true);
        setTaskError("");
        try {
            const response = await getTasks();
            if (!isSuccessful(response)) {
                throw new Error(response?.data?.detail || response?.data?.message || "Unable to load tasks.");
            }
            const taskData = Array.isArray(response.data) ? response.data : response.data?.results;
            if (!Array.isArray(taskData)) {
                throw new Error("Unexpected task response from the server.");
            }
            setTasks(taskData);
            if (!Array.isArray(taskData)) throw new Error("Unexpected task response from the server.");
        } catch (error) {
            console.error("Error loading dashboard tasks:", error);
            setTaskError(error.message || "Unable to load tasks.");
        } finally {
            setTasksLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    // ==================== FILTER NOTES, LISTS, TASKS ====================
    const activeNotes = notes.filter((note) => !note.is_deleted && !note.is_archived);
    const filteredNotes = activeNotes.filter((note) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return true;
        const title = (note.title || "").toLowerCase();
        const content = note.is_locked ? "": (note.content || "").toLowerCase();
        return title.includes(query) || content.includes(query);
    });
    const visibleNotes = activeFilter === "All" || activeFilter === "Notes" ? filteredNotes : [];

    const activeLists = lists.filter((list) => !list.is_deleted && !list.is_archived);
    const filteredLists = activeLists.filter((list) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return true;
        const title = getListTitle(list).toLowerCase();
        const itemText = getListItems(list).map((item) => getItemText(item)).join(" ").toLowerCase();
        return title.includes(query) || itemText.includes(query);
    });
    const visibleLists = activeFilter === "All" || activeFilter === "Lists" ? filteredLists: [];

    const activeTasks = tasks.filter((task) => !task.is_deleted && !task.is_archived);
    const filteredTasks = activeTasks.filter((task) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return true;
        const title = (task.title || "").toLowerCase();
        const description = (task.description || "").toLowerCase();
        const assignedTo = typeof task.assigned_to === "string" ? task.assigned_to.toLowerCase() : "";
        return title.includes(query) || description.includes(query) || assignedTo.includes(query);
    });
    const visibleTasks = (activeFilter === "All" || activeFilter === "Tasks") ? filteredTasks : [];


    // ==================== UPDATE DASHBOARD TASK ====================
    const handleDashboardTaskUpdate = async (field, value) => {
        if (!selectedTask || isUpdatingTask) return;
        const previousTask = selectedTask;
        const updatedTask = { ...previousTask, [field]: value };
        setSelectedTask(updatedTask);
        setIsUpdatingTask(true);
        setTaskActionError("");
        try {
            const response = await updateTask(previousTask.id, {
                title: updatedTask.title || "",
                description: updatedTask.description || "",
                assigned_to: updatedTask.assigned_to || "",
                priority: updatedTask.priority || "medium",
                status: updatedTask.status || "pending",
                due_date: updatedTask.due_date || null,
            });
            if (!isSuccessful(response)) {
                throw new Error(response?.data?.detail || response?.data?.error || response?.data?.message || "Unable to update task.");
            }
            const savedTask = response.data;
            if (!savedTask || typeof savedTask !== "object" || Array.isArray(savedTask) || savedTask.id == null) {
                throw new Error("The server returned an unexpected task response.");
            }
            const finalTask = { ...updatedTask, ...savedTask };
            setTasks((current) => current.map((task) => String(task.id) === String(previousTask.id) ? finalTask : task));
            setSelectedTask((current) => current && String(current.id) === String(previousTask.id) ? finalTask : current);
        } catch (error) {
            setSelectedTask(previousTask);
            setTaskActionError(error.message || "Unable to update task.");
        } finally {
            setIsUpdatingTask(false);
        }
    };
    const handleUpdateDashboardTaskField = (field, value) =>
        handleDashboardTaskUpdate(field, value);

    // ==================== NOTE NAVIGATION ====================
    const handleEditNote = (note) => navigate("/notes", { state: { noteId: note.id, openForEdit: true } });
    const handleOpenNotePreview = (note) => setPreviewNote(note);
    const handleNoteCardKeyDown = (event, note) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            handleOpenNotePreview(note);
        }
    };

    // ==================== LIST NAVIGATION ====================
    const handleOpenListPreview = (list) => { setPreviewList(list); setListActionError(""); };
    const handleCloseListPreview = () => { setPreviewList(null); setListActionError(""); };
    const handleListCardKeyDown = (event, list) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            handleOpenListPreview(list);
        }
    };

    // ==================== TASK NAVIGATION ====================
    const handleEditDashboardTask = (task) => task?.id && navigate("/tasks", { state: { editTaskId: task.id } });

    // ==================== CREATE MENU ====================
    const handleCloseCreateMenu = () => {setShowCreateMenu(false)};
    const handleNavigateFromCreateMenu = (path) => {
        setShowCreateMenu(false);
        navigate(path);
    };

    // ==================== SIDEBAR NAVIGATION ====================
    const handleNavigateFromSidebar = (path) => {
        setShowSidebar(false);
        navigate(path);
    };

    // ==================== LOGOUT ====================
    const handleLogout = async () => {
        if (isLoggingOut) return;

        setIsLoggingOut(true);
        setLogoutError("");

        try {
            const result = await logoutUser();

            if (result.status !== 200) {
                throw new Error(
                    result.data?.detail ||
                    result.data?.error ||
                    "Unable to log out. Please try again."
                );
            }

            setShowLogoutConfirm(false);
            navigate("/login", { replace: true });
        } catch (error) {
            setLogoutError(
                error.message || "Unable to log out. Please try again."
            );
        } finally {
            setIsLoggingOut(false);
        }
    };

    // ==================== CHECKLIST HELPERS ====================
    const updateItemInList = (listId, itemId, updatedItem) => {
        const updateItems = (list) => {
            if (String(list.id) !== String(listId)) return list;
            return {
                ...list,
                items: getListItems(list).map((item) => String(item.id) === String(itemId) ? { ...item, ...updatedItem } : item),
            };
        };
        setLists((currentLists) => currentLists.map(updateItems));
        setPreviewList((current) => current && String(current.id) === String(listId) ? updateItems(current) : current);
    };

    // ==================== TOGGLE CHECKLIST ITEM ====================
    const handleToggleListItem = async (list, item) => {
        if (!list?.id || !item?.id || savingItemId !== null) return;
        const nextCompleted = !isItemCompleted(item);
        const previousCompleted = isItemCompleted(item);
        setListActionError("");
        setSavingItemId(item.id);
        updateItemInList(list.id, item.id, { is_completed: nextCompleted });
        try {
            const response = await updateListItem(list.id, item.id, { text: item.text ?? item.title ?? "", is_completed: nextCompleted });
            if (!isSuccessful(response)) {
                updateItemInList(list.id, item.id, { is_completed: previousCompleted });
                setListActionError(response?.data?.error || "Unable to update the checklist item. Please try again.");
                return;
            }
            const returnedItem = response.data?.item ?? response.data;
            if (returnedItem && typeof returnedItem === "object" && String(returnedItem.id) === String(item.id)) {
                updateItemInList(list.id, item.id, returnedItem);
            }
        } catch (error) {
            console.error("Error updating checklist item:", error);
            updateItemInList(list.id, item.id, { is_completed: previousCompleted });
            setListActionError("Could not connect to the server. Your change was not saved.");
        } finally {
            setSavingItemId(null);
        }
    };

    const getPrivateNoteTitle = (note, notes) => {
        if (!note) return "";
        const actualTitle = String(note.title || "").trim();
        if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
        const lockedNotes = notes.filter((item) => item.is_locked).sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateA - dateB || Number(a.id) - Number(b.id);
        });
        const index = lockedNotes.findIndex((item) => String(item.id) === String(note.id));
        return index >= 0 ? `Private Notes (${index + 1})` : actualTitle || "Private Notes";
    };

    const getPrivateListTitle = (list, lists) => {
        if (!list) return "";
        const actualTitle = String(list.title || "").trim();
        if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
        const lockedLists = lists.filter((item) => item.is_locked).sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateA - dateB || Number(a.id) - Number(b.id);
        });
        const index = lockedLists.findIndex((item) => String(item.id) === String(list.id));
        return index >= 0 ? `Private Lists (${index + 1})` : actualTitle || "Private Lists";
    };

    const getPrivateTaskTitle = (task, tasks) => {
        if (!task) return "";
        const actualTitle = String(task.title || "").trim();
        if (/\bcopy(?:\(\d+\))?$/i.test(actualTitle)) return actualTitle;
        const lockedTasks = tasks.filter((item) => item.is_locked).sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateA - dateB || Number(a.id) - Number(b.id);
        });
        const index = lockedTasks.findIndex((item) => String(item.id) === String(task.id));
        return index >= 0 ? `Private Tasks (${index + 1})` : actualTitle || "Private Tasks";
    };

    // ==================== LOADING STATE ====================
    if (isLoading) return <Loader message="Loading your Dashboard..." />;

    // ==================== Main Dashboard Page ====================
    return (
        <main className="dashboard">
            {/* Header */}
            <header className="dashboard-header">
                <div className="dashboard-logo"><img src={focusHubLogo} alt="FocusHub" /></div>
                <div className="dashboard-search">
                    <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <input type="search" placeholder="Search FocusHub..." aria-label="Search your workspace" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
                </div>
                <button type="button" className="menu-button" aria-label="Open navigation menu" aria-expanded={showSidebar} onClick={() => setShowSidebar(true)}>
                    <i className="fa-solid fa-bars" aria-hidden="true" />
                </button>
            </header>

            {/* Filters */}
            <nav className="dashboard-filters" aria-label="Workspace filters">
                {filters.map((filter) => (
                    <button type="button" key={filter} className={`filter-button ${activeFilter === filter ? "active" : ""}`} aria-pressed={activeFilter === filter} onClick={() => setActiveFilter(filter)}>
                        {filter}
                    </button>
                ))}
            </nav>

            {/* Welcome */}
            <section className="dashboard-welcome">
                <span className="dashboard-eyebrow">YOUR PRODUCTIVITY SPACE</span>
                <h1>Welcome to FocusHub</h1>
                <p>Keep your notes, lists and tasks organized in one place.</p>
            </section>

            {/* Overview Cards */}
            <section className="dashboard-overview" aria-label="Workspace categories">
                <article className="overview-card">
                    <div className="overview-icon notes-icon"><i className="fa-regular fa-note-sticky" aria-hidden="true" /></div>
                    <div>
                        <h3>Notes</h3>
                        <p>Capture your ideas</p>
                    </div>
                    <button type="button" onClick={() => navigate("/notes")} aria-label="Open notes">
                        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                    </button>
                </article>
                <article className="overview-card">
                    <div className="overview-icon lists-icon"><i className="fa-solid fa-list-check" aria-hidden="true" /></div>
                    <div>
                        <h3>Lists</h3>
                        <p>Organize your plans</p>
                    </div>
                    <button type="button" onClick={() => navigate("/lists")} aria-label="Open lists">
                        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                    </button>
                </article>
                <article className="overview-card">
                    <div className="overview-icon tasks-icon"><i className="fa-solid fa-check" aria-hidden="true" /></div>
                    <div>
                        <h3>Tasks</h3>
                        <p>Stay on track</p>
                    </div>
                    <button type="button" onClick={() => navigate("/tasks")} aria-label="Open tasks">
                        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                    </button>
                </article>
            </section>

            {/* Workspace */}
            <section className="dashboard-content">
                <div className="dashboard-section-heading">
                    <div>
                        <h2>Your workspace</h2>
                        <p>{searchQuery.trim() ? `Search for "${searchQuery.trim()}" across your workspace.` : "Your notes, lists and tasks will be easy to access here."}</p>
                    </div>
                </div>

                {/* Notes Section */}
                {(activeFilter === "All" || activeFilter === "Notes") && (
                    <section className="workspace-category">
                        <div className="workspace-category-heading">
                            <div>
                                <h3><i className="fa-regular fa-note-sticky" aria-hidden="true" /> Notes</h3>
                                <p>Your saved notes</p>
                            </div>
                            {activeNotes.length > 0 && (
                                <button type="button" onClick={() => navigate("/notes")}>
                                    View all <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {loadError ? (
                            <div className="workspace-category-empty" role="alert">
                                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                                <p>{loadError}</p>
                                <button type="button" onClick={fetchNotes}><i className="fa-solid fa-rotate-right" aria-hidden="true" /> Try again</button>
                            </div>
                            ) : visibleNotes.length > 0 ? (
                                <div className="dashboard-notes-grid">
                                    {visibleNotes.map((note) => (
                                    <article className="dashboard-note-card" key={note.id} onClick={() => handleOpenNotePreview(note)} onKeyDown={(event) => handleNoteCardKeyDown(event, note)} role="button" tabIndex={0} aria-label={`Preview note: ${note.title || "Untitled note"}`}>
                                        <h3>{note.is_locked ? getPrivateNoteTitle(note, activeNotes) : note.title || "Untitled note"}</h3>
                                        <p>{note.is_locked ? "This is a secured note." : note.content || "No content"}</p>
                                        {note.is_pinned && <span className="dashboard-note-pin"><i className="fa-solid fa-thumbtack" aria-hidden="true" /> Pinned</span>}
                                    </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="workspace-category-empty">
                                    <i className="fa-regular fa-note-sticky" aria-hidden="true" />
                                    <p>{searchQuery.trim() ? "No matching notes found." : "No saved notes yet."}</p>
                                </div>
                        )}
                    </section>
                )}

                {/* Lists Section */}
                {(activeFilter === "All" || activeFilter === "Lists") && (
                    <section className="workspace-category">
                        <div className="workspace-category-heading">
                            <div>
                                <h3><i className="fa-solid fa-list-check" aria-hidden="true"/>Lists</h3>
                                <p>Your saved lists</p>
                            </div>
                            {activeLists.length > 0 && (
                                <button type="button" onClick={() => navigate("/lists")}>
                                    View all <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {listsError ? (
                            <div className="workspace-category-empty" role="alert">
                                <p>{listsError}</p>
                                <button type="button" onClick={fetchLists}>Try again</button>
                            </div>
                        ) : visibleLists.length > 0 ? (
                            <div className="dashboard-notes-grid dashboard-lists-grid">
                                {visibleLists.map((list) => {
                                    const isLocked = Boolean(list.is_locked);
                                    const items = isLocked ? [] : getListItems(list);
                                    const completed = items.filter(isItemCompleted).length;
                                    const progress = items.length ? Math.round((completed / items.length) * 100) : 0;
                                    const listTitle = isLocked ? getPrivateListTitle(list, lists): getListTitle(list);
                                    return (
                                        <article className="dashboard-note-card dashboard-list-card" key={list.id}role="button" tabIndex={0} onClick={() => handleOpenListPreview(list)} onKeyDown={(event) => handleListCardKeyDown(event, list)}aria-label={`Open list: ${listTitle}`}>
                                            <h3>{listTitle}</h3>
                                            {isLocked ? (
                                                <p> This is a secured list.</p>
                                            ) : (
                                                <>
                                                    {items.length > 0 ? (
                                                    items.slice(0, 3).map((item, index) => (
                                                        <div className="lists-item-preview" key={item.id ?? `${list.id}-${index}`}>
                                                        <i className={`fa-regular ${isItemCompleted(item) ? "fa-circle-check completed" : "fa-circle"}`} aria-hidden="true" />
                                                        <span className={isItemCompleted(item) ? "completed" : ""}>{getItemText(item)}</span>
                                                        {index === 2 && items.length > 3 && <span className="dashboard-list-more-inline">+{items.length - 3} more items</span>}
                                                        </div>
                                                    ))
                                                    ) : (
                                                        <p>No checklist items yet.</p>
                                                    )}
                                                    {items.length > 3 && <p className="dashboard-list-more">+{items.length - 3} more items</p>}
                                                    <p>{completed} of {items.length} completed</p>
                                                    <div className="lists-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${listTitle} completion`}>
                                                        <div className="lists-progress-fill" style={{ width: `${progress}%` }} />
                                                    </div>
                                                </>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="workspace-category-empty">
                                <i className="fa-solid fa-list-check" aria-hidden="true"/>
                                <p>{searchQuery.trim() ? "No matching lists found.": "No saved lists yet."}</p>
                            </div>
                        )}
                    </section>
                )}

                {/* Tasks Section */}
                {(activeFilter === "All" || activeFilter === "Tasks") && (
                    <section className="workspace-category">
                        <div className="workspace-category-heading">
                            <div>
                                <h3><i className="fa-solid fa-check" aria-hidden="true" /> Tasks</h3>
                                <p>Your saved tasks</p>
                            </div>
                            {activeTasks.length > 0 && (
                                <button type="button" onClick={() => navigate("/tasks")}>
                                    View all <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {tasksLoading ? (
                            <div className="workspace-category-empty"><p>Loading tasks...</p></div>
                        ) : taskError ? (
                            <div className="workspace-category-empty" role="alert">
                                <p>{taskError}</p>
                                <button type="button" onClick={fetchTasks}>Try again</button>
                            </div>
                        ) : visibleTasks.length > 0 ? (
                            <div className="dashboard-task-grid">
                                {visibleTasks.map((task) => (
                                    <button type="button" className="dashboard-task-card" key={task.id} onClick={() => {setSelectedTask(task); setTaskActionError(""); }}>
                                    <h3>{task.is_locked ? getPrivateTaskTitle(task, tasks) : task.title || "Untitled task"}</h3>
                                    <p>{task.is_locked ? "This is a secured task." : task.description || "No description added."}</p>
                                    {!task.is_locked && (
                                        <>
                                            <div className="dashboard-task-meta">
                                                <span className={`dashboard-task-priority ${(task.priority || "medium").toLowerCase().replace(/\s+/g, "-")}`}>Priority: {formatTaskValue(task.priority || "medium")}</span>
                                                <span className={`dashboard-task-status ${(task.status || "pending").toLowerCase().replace(/[\s_]+/g, "-")}`}>Status: {formatTaskValue(task.status || "pending")}</span>
                                            </div>
                                            <small className="dashboard-task-date"><i className="fa-regular fa-calendar" aria-hidden="true" />{" "}{task.due_date ? `Due: ${formatTaskDate(task.due_date)}` : "Not Fixed"}</small>
                                        </>
                                    )}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="workspace-category-empty">
                                <i className="fa-solid fa-check" aria-hidden="true" />
                                <p>{searchQuery.trim() ? "No matching tasks found." : "Your saved tasks will appear here."}</p>
                            </div>
                        )}
                    </section>
                )}
            </section>

            {/* Floating Create Button */}
            <button type="button" className="dashboard-create-button dashboard-floating-create" onClick={() => setShowCreateMenu((previous) => !previous)} aria-expanded={showCreateMenu} aria-haspopup="true">
                <i className="fa-solid fa-plus" aria-hidden="true" /> <span>Create something</span>
            </button>

            {/* Create Menu */}
            {showCreateMenu && (
                <>
                    <button type="button" className="create-popup-backdrop" aria-label="Close create menu" onClick={handleCloseCreateMenu} />
                    <div className="create-menu create-popup" role="group" aria-label="Create new">
                        <h3>Create new</h3>
                        <button type="button" onClick={() => handleNavigateFromCreateMenu("/notes")}><i className="fa-regular fa-note-sticky" aria-hidden="true" /> <span>Note</span></button>
                        <button type="button" onClick={() => handleNavigateFromCreateMenu("/lists")}><i className="fa-solid fa-list-check" aria-hidden="true" /> <span>List</span></button>
                        <button type="button" onClick={() => handleNavigateFromCreateMenu("/tasks")}><i className="fa-solid fa-check" aria-hidden="true" /> <span>Task</span></button>
                        <button type="button" className="create-menu-close" onClick={handleCloseCreateMenu}>Cancel</button>
                    </div>
                </>
            )}

            {/* Sidebar */}
            {showSidebar && (
                <div className="sidebar-backdrop" onClick={() => setShowSidebar(false)}>
                    <aside className="dashboard-sidebar" role="dialog" aria-modal="true" aria-label="Navigation menu" onClick={(event) => event.stopPropagation()}>
                        <div className="sidebar-header">
                            <img src={focusHubLogo} alt="FocusHub" />
                            <button type="button" className="sidebar-close" aria-label="Close navigation menu" onClick={() => setShowSidebar(false)}>
                                <i className="fa-solid fa-xmark" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="sidebar-divider" />
                        <nav className="sidebar-navigation" aria-label="Main navigation">
                            <button type="button" onClick={() => handleNavigateFromSidebar("/dashboard")}><i className="fa-solid fa-house" aria-hidden="true" /> <span>Dashboard</span></button>
                            <button type="button" onClick={() => handleNavigateFromSidebar("/archive")}><i className="fa-solid fa-box-archive" aria-hidden="true" /> <span>Archived</span></button>
                            <button type="button" onClick={() => handleNavigateFromSidebar("/trash")}><i className="fa-solid fa-trash" aria-hidden="true" /> <span>Trash</span></button>
                            <button type="button" onClick={() => handleNavigateFromSidebar("/account")}><i className="fa-solid fa-user" aria-hidden="true" /> <span>Account</span></button>
                            <div className="sidebar-divider" />
                            <button type="button" className="sidebar-logout-button" onClick={() => { setShowSidebar(false); setLogoutError(""); setShowLogoutConfirm(true); }}>
                                <i className="fa-solid fa-right-from-bracket" aria-hidden="true" /> <span>Logout</span>
                            </button>
                        </nav>
                    </aside>
                </div>
            )}

            {/* Note Preview Modal */}
            {previewNote && (
                <div className="note-preview-overlay" onClick={() => setPreviewNote(null)}>
                    <section className="note-preview-modal" role="dialog" aria-modal="true" aria-labelledby="note-preview-title" onClick={(event) => event.stopPropagation()}>
                        <header className="note-preview-header">
                            <h2 id="note-preview-title">{previewNote.is_locked ? getPrivateNoteTitle(previewNote, activeNotes) : previewNote.title || "Untitled note"}</h2>
                            <div className="note-preview-actions">
                                <button type="button" title="Edit note" aria-label="Edit note" onClick={() => { const note = previewNote; setPreviewNote(null); handleEditNote(note); }}>
                                    <i className="fa-solid fa-pen" aria-hidden="true" />
                                </button>
                                <button type="button" title="Close preview" aria-label="Close preview" onClick={() => setPreviewNote(null)}>
                                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                                </button>
                            </div>
                        </header>
                        <div className="note-preview-divider" />
                        <div className="note-preview-content">
                            {previewNote.is_locked ? "This is a secured note. Open it in Notes to unlock and view its content." : previewNote.content || "No content"}
                        </div>
                    </section>
                </div>
            )}

            {/* List Preview Modal */}
            {previewList && (
                <div className="note-preview-overlay" onClick={handleCloseListPreview}>
                    <section className="note-preview-modal dashboard-list-preview" role="dialog" aria-modal="true" aria-labelledby="list-preview-title" onClick={(e) => e.stopPropagation()}>
                        <header className="note-preview-header">
                            <h2 id="list-preview-title">{previewList.is_locked ? getPrivateListTitle(previewList, lists) : getListTitle(previewList)}</h2>
                            <div className="note-preview-actions">
                                <button type="button" title="Open list editor" aria-label="Open list editor" onClick={() => { const sel = previewList; setPreviewList(null); navigate("/lists", { state: { listId: sel.id, openForEdit: true } }); }}><i className="fa-solid fa-pen" aria-hidden="true" /></button>
                                <button type="button" title="Close preview" aria-label="Close preview" onClick={handleCloseListPreview}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
                            </div>
                        </header>
                        <div className="note-preview-divider" />
                        {previewList.is_locked ? (
                            <p>This is a secured list. Open it in Lists to unlock and view its lists.</p>
                        ) : (
                            (() => {
                                const items = getListItems(previewList), completed = items.filter(isItemCompleted).length;
                                const progress = items.length ? Math.round((completed / items.length) * 100) : 0;
                                return (
                                    <>
                                        <div className="dashboard-list-progress-summary"><h3>Completed</h3><p>{completed} of {items.length}</p></div>
                                        <div className="lists-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${getListTitle(previewList)} completion`}><div className="lists-progress-fill" style={{ width: `${progress}%` }} /></div>
                                        <div className="dashboard-preview-list-items">
                                            {items.map((item, idx) => {
                                                const isSaving = savingItemId === item.id;
                                                return (
                                                    <div className="dashboard-preview-list-item" key={item.id ?? `${previewList.id}-${idx}`}>
                                                        <input type="checkbox" checked={isItemCompleted(item)} disabled={isSaving || item.id == null} aria-label={`Mark ${getItemText(item)} completed`} onChange={() => handleToggleListItem(previewList, item)} />
                                                        <span className={isItemCompleted(item) ? "completed" : ""}>{getItemText(item)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {items.length === 0 && <p>No checklist items in this list.</p>}
                                        {listActionError && <p role="alert">{listActionError}</p>}
                                    </>
                                );
                            })()
                        )}
                    </section>
                </div>
            )}

            {/* Task Preview Modal */}
            {selectedTask && (
                <div className="note-preview-overlay" onMouseDown={(e) => e.target === e.currentTarget && !isUpdatingTask && (setSelectedTask(null), setTaskActionError(""))}>
                    <section className="note-preview-modal dashboard-task-details" role="dialog" aria-modal="true" aria-labelledby="dashboard-task-title" onMouseDown={(e) => e.stopPropagation()}>
                        <header className="note-preview-header">
                            <h2 id="dashboard-task-title">{selectedTask.is_locked ? getPrivateTaskTitle(selectedTask, tasks) : selectedTask.title || "Untitled task"}</h2>
                            <div className="note-preview-actions">
                                <button type="button" className="task-icon-button" title="Edit task" aria-label="Edit task" disabled={isUpdatingTask} onClick={() => handleEditDashboardTask(selectedTask)}><i className="fa-solid fa-pen" aria-hidden="true" /></button>
                                <button type="button" title="Close preview" aria-label="Close task preview" disabled={isUpdatingTask} onClick={() => { setSelectedTask(null); setTaskActionError(""); }}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
                            </div>
                        </header>
                        <div className="note-preview-divider" />
                        {selectedTask.is_locked ? (
                            <p>This is a secured task. Open it in Tasks to unlock and view its tasks.</p>
                        ) : (
                            <div className="note-preview-content dashboard-task-detail-content">
                                <div className="task-form-field"><strong><i className="fa-regular fa-file-lines" aria-hidden="true" /> Description</strong><p>{selectedTask.description || "No description added."}</p></div>
                                <div className="task-form-field"><strong><i className="fa-regular fa-user" aria-hidden="true" /> Assigned to</strong><p>{selectedTask.assigned_to || "Unassigned"}</p></div>
                                <div className="task-form-row">
                                    <label className="task-form-field"><span>Priority</span>
                                        <select value={selectedTask.priority || "medium"} disabled={isUpdatingTask} onChange={(e) => handleDashboardTaskUpdate("priority", e.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
                                    </label>
                                    <label className="task-form-field"><span>Status</span>
                                        <select value={selectedTask.status || "pending"} disabled={isUpdatingTask} onChange={(e) => handleDashboardTaskUpdate("status", e.target.value)}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select>
                                    </label>
                                </div>
                                <div className="task-form-field"><strong><i className="fa-regular fa-calendar" aria-hidden="true" /> Due date</strong><p>{selectedTask.due_date ? formatTaskDate(selectedTask.due_date) : "Not Fixed"}</p></div>
                                {isUpdatingTask && <p className="dashboard-task-saving" role="status" aria-live="polite"><i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Saving changes...</p>}
                                {taskActionError && <p className="dashboard-task-error" role="alert"><i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {taskActionError}</p>}
                            </div>
                        )}
                    </section>
                </div>
            )}

            {/* Logout Confirmation Modal */}
            {showLogoutConfirm && (
                <div className="logout-confirm-overlay" onClick={() => !isLoggingOut && (setShowLogoutConfirm(false), setLogoutError(""))}>
                    <section className="logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title" onClick={(event) => event.stopPropagation()}>
                        <div className="logout-confirm-icon"><i className="fa-solid fa-right-from-bracket" aria-hidden="true" /></div>
                        <h2 id="logout-confirm-title">Logout from FocusHub?</h2>
                        <p>Are you sure you want to log out of your account?</p>
                        {logoutError && <p className="logout-confirm-error" role="alert">{logoutError}</p>}
                        <div className="logout-confirm-actions">
                            <button type="button" className="logout-cancel-button" disabled={isLoggingOut} onClick={() => { setShowLogoutConfirm(false); setLogoutError(""); }}>Cancel</button>
                            <button type="button" className="logout-confirm-button" disabled={isLoggingOut} onClick={handleLogout}>
                                {isLoggingOut ? <><i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Logging out...</> : <><i className="fa-solid fa-right-from-bracket" aria-hidden="true" /> Logout</>}
                            </button>
                        </div>
                    </section>
                </div>
            )}

        </main>
    );
}

export default Dashboard;