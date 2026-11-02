import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getLists, getList, createList, updateList, deleteList, archiveList, copyList, shareList, getListItems, createListItem, updateListItem, deleteListItem, getArchivedLists, toggleListPin, verifyCardLockPassword } from "../services/listService";
import { getAccountStatus } from "../services/accountService";
import Loader from "../components/Loader";
import "../index.css";

const EMPTY_LIST = { title: "", items: [], is_locked: false };

const getResponseData = (response) => {
  if (!response || (typeof response.status === "number" && (response.status < 200 || response.status >= 300))) {
    throw new Error(response?.data?.detail || response?.data?.error || response?.data?.message || "Something went wrong. Please try again.");
  }
  return response.data;
};

const normalizeItems = (items) => !Array.isArray(items) ? [] : items.map((item) => ({ ...item, text: item.text || "", is_completed: Boolean(item.is_completed), isDraft: false }));

function Lists() {
  const popupTimeoutRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const [lists, setLists] = useState([]);
  const [selectedListIds, setSelectedListIds] = useState([]);
  const [selectedList, setSelectedList] = useState(null);

  const [isLoadingLists, setIsLoadingLists] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showListForm, setShowListForm] = useState(false);
  const [isEditingList, setIsEditingList] = useState(false);
  const [isSavingList, setIsSavingList] = useState(false);

  const [listForm, setListForm] = useState({ ...EMPTY_LIST });
  const [listErrors, setListErrors] = useState({});
  const [itemText, setItemText] = useState("");

  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("grid");
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [actionListId, setActionListId] = useState(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const [cardLockPasswordSet, setCardLockPasswordSet] = useState(false);
  const [showUnlockPrompt, setshowUnlockPrompt] = useState(false);
  const [showSecurePrompt, setShowSecurePrompt] = useState(false);

  const [securePassword, setSecurePassword] = useState("");
  const [showSecurePassword, setShowSecurePassword] = useState(false);
  const [securePasswordError, setSecurePasswordError] = useState("");
  const [isVerifyingPassword, setisVerifyingPassword] = useState(false);

  const [unlockedListIds, setUnlockedListIds] = useState([]);
  const [secureAction, setSecureAction] = useState("");
  const [secureActionListIds, setSecureActionListIds] = useState([]);

  // ========== Popup Lists ==========
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

  // ========== Fetch Lists ==========
  const fetchLists = useCallback(async () => {
    setIsLoadingLists(true);
    setLoadError("");
    try {
      const result = await getLists();
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || result?.data?.message || "Unable to load lists. Please try again.");
      }
      const fetchedLists = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.results) ? result.data.results : Array.isArray(result.data?.data) ? result.data.data : null;
      if (!fetchedLists) throw new Error("The server returned an unexpected response.");
      setLists(fetchedLists);
      const validIds = new Set(fetchedLists.map((list) => String(list.id)));
      setSelectedListIds((current) => current.filter((id) => validIds.has(String(id))));
      return fetchedLists;
    } catch (error) {
      console.error("Error fetching lists:", error);
      setLoadError(error.message || "Unable to connect to FocusHub. Check your connection and try again.");
      return [];
    } finally {
      setIsLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  // ========== Lists Directs to Accounts page ==========
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
    checkCardLockPassword()
    return () => {isMounted = false};
  }, []);
  const isListUnlocked = (list) =>
    Boolean(list && (!list.is_locked || unlockedListIds.some((id) => String(id) === String(list.id)))
  );

  // ========== Sorting Lists ==========
  const sortedLists = useMemo(() => {
    return lists
      .filter((list) => !list.is_archived && !list.is_deleted)
      .sort((a, b) => {
        if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
        if (sortBy === "title-asc") return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
        if (sortBy === "title-desc") return (b.title || "").localeCompare(a.title || "", undefined, { sensitivity: "base"});
        const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
        const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
        return sortBy === "oldest" ? dateA - dateB : dateB - dateA;
      });
  }, [lists, sortBy]);

  // ========== Selecting Lists ==========
  const isListSelected = (listId) => selectedListIds.some((id) => String(id) === String(listId));
  const getSelectedLists = () => {
    if (selectedListIds.length === 0) {
      showPopup("error", "Select at least one list first.");
      return [];
    }
    return sortedLists.filter((list) => isListSelected(list.id));
  };
  const toggleListSelection = (event, listId) => {
    event.stopPropagation();
    setSelectedListIds((current) => current.some((selid) => String(selid) === String(listId)) ? current.filter((selid) => String(selid) !== String(listId)) : [...current, listId]
    );
  };
  const allListsSelected = sortedLists.length > 0 && sortedLists.every((list) => isListSelected(list.id));
  const handleToggleSelectAll = () => {
    setSelectedListIds((current) => {
      const allSelected = sortedLists.length > 0 && sortedLists.every((list) => current.some((id) => String(id) === String(list.id)));
      return allSelected ? [] : sortedLists.map((list) => list.id);
    });
  };

  // ========== Pin / Unpin Lists ==========
  const pinnedLists = sortedLists.filter((list) => list.is_pinned);
  const unpinnedLists = sortedLists.filter((list) => !list.is_pinned);
  const handleTogglePin = async (event, list) => {
    event.stopPropagation();
    if (isProcessingAction) return;
    const newPinnedStatus = !list.is_pinned;
    setIsProcessingAction(true);
    setActionListId(list.id);
    try {
      const result = await toggleListPin(list.id, newPinnedStatus);
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(result?.data?.detail || result?.data?.error || "Unable to update list pin.");
      }
      await fetchLists();
      showPopup("success", newPinnedStatus ? "List pinned." : "List unpinned.");
    } catch (error) {
      console.error("Error updating list pin:", error);
      showPopup("error", error.message || "Unable to update list pin.");
    } finally {
      setIsProcessingAction(false);
      setActionListId(null);
    }
  };

  // ========== Archive Selected Lists ==========
  const handleArchiveSelected = async () => {
    const selectedLists = getSelectedLists();
    if (!selectedLists.length || isProcessingAction) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const results = await Promise.allSettled(selectedLists.map((list) => archiveList(list.id, true)));
      const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
      await fetchLists();
      setSelectedListIds([]);
      if (failedCount === 0) {
        showPopup("success", "Selected lists archived successfully.");
      } else {
        showPopup("error", `${failedCount} list(s) could not be archived.`);
      }
    } catch (error) {
      console.error("Error archiving lists:", error);
      showPopup("error", "Unable to archive the selected lists.");
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ========== Share Selected Lists ==========
  const handleSendSelected = async () => {
    const selectedLists = getSelectedLists();
    if (!selectedLists.length || isProcessingAction) return;
    if (selectedLists.some((list) => list.is_locked)) {
      setSecureAction("send");
      setSecureActionListIds(selectedLists.map((l) => l.id));
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setShowMoreMenu(false);
      return setshowUnlockPrompt(true);
    }
    await sendSelectedLists(selectedLists);
  };
  const sendSelectedLists = async (selectedLists) => {
    if (!selectedLists.length || isProcessingAction) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const sharedLists = [];
      for (const list of selectedLists) {
        const result = await shareList(list.id);
        if (!result || result.status < 200 || result.status >= 300) {
          throw new Error(result?.data?.detail || result?.data?.error || `Unable to prepare "${list.is_locked ? getPrivateListTitle(list) : list.title || "Untitled list"}" for sharing.`);
        }
        sharedLists.push({ source: list, data: result.data?.data ?? result.data });
      }
      const shareText = sharedLists.map(({ source, data }) => {
        const title = source.is_locked ? getPrivateListTitle(source) : data.title || "Untitled list";
        return [title, "", ...(Array.isArray(data.items) ? data.items : []).map((item) => `${item.is_completed ? "[x]" : "[ ]"} ${item.text || ""}`)].join("\n");
      }).join("\n\n--------------------\n\n");
      if (navigator.share) {
        await navigator.share({ title: "FocusHub Lists", text: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        showPopup("success", "Selected lists copied. You can paste them into a sharing app.");
      } else {
        showPopup("error", "Sharing is unavailable in this browser.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("Error sharing lists:", error);
        showPopup("error", error.message || "Unable to share the selected lists.");
      }
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ========== Copy Selected Lists ==========
  const handleCopySelected = async () => {
    const selectedLists = getSelectedLists();
    if (!selectedLists.length || isProcessingAction) return;
    const hasLockedList = selectedLists.some((list) => list.is_locked);
    if (hasLockedList) {
      setSecureAction("copy");
      setSecureActionListIds(selectedLists.map((list) => list.id));
      setSecurePassword("");
      setSecurePasswordError("");
      setShowSecurePassword(false);
      setShowMoreMenu(false);
      setshowUnlockPrompt(true);
      return;
    }
    await copySelectedLists(selectedLists);
  };
  const copySelectedLists = async (selectedLists) => {
    if (!selectedLists.length) return;
    setIsProcessingAction(true);
    setShowMoreMenu(false);
    try {
      const latestResponse = await getLists();
      if (!latestResponse || latestResponse.status < 200 || latestResponse.status >= 300) throw new Error("Unable to load existing lists.");
      const latestLists = Array.isArray(latestResponse.data) ? latestResponse.data : latestResponse.data?.results || [];
      const existingTitles = new Set(latestLists.map((l) => String(l.title || "").trim().toLocaleLowerCase()));
      let failedCount = 0;
      for (const list of selectedLists) {
        const baseTitle = list.is_locked ? getPrivateListTitle(list) : String(list.title || "Untitled list").trim();
        const cleanBaseTitle = baseTitle.replace(/\s+copy(?:\s+\(\d+\))?$/i, "").trim() || "Untitled list";
        let copyTitle = `${cleanBaseTitle} copy`, copyNumber = 1;
        while (existingTitles.has(copyTitle.toLocaleLowerCase())) {
          copyTitle = `${cleanBaseTitle} copy (${copyNumber})`;
          copyNumber++;
        }
        existingTitles.add(copyTitle.toLocaleLowerCase());
        try {
          const result = await copyList(list.id, copyTitle);
          if (!result || result.status < 200 || result.status >= 300) failedCount++;
        } catch {
          failedCount++;
        }
      }
      await fetchLists();
      setSelectedListIds([]);
      showPopup(failedCount === 0 ? "success" : "error", failedCount === 0 ? "Selected lists copied." : `${failedCount} list(s) could not be copied.`);
    } catch (error) {
      showPopup("error", error.message || "Unable to copy the selected lists.");
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ========== Bulk Delete Lists ==========
  const confirmBulkDelete = async () => {
    if (selectedListIds.length === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(selectedListIds.map((id) => deleteList(id)));
      const failedCount = results.filter((res) => res.status !== "fulfilled" || !res.value || res.value.status < 200 || res.value.status >= 300).length;
      await fetchLists();
      setShowBulkDeleteConfirm(false);
      setSelectedListIds([]);
      if (failedCount === 0) {
        showPopup("success", "Selected lists moved to Trash.");
      } else {
        showPopup("error", `${failedCount} list(s) could not be moved to Trash.`);
      }
    } catch (error) {
      console.error("Error moving lists to Trash:", error);
      showPopup("error", "Unable to move Lists to Trash.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ========== More actions for List ==========
  useEffect(() => {
      if (selectedListIds.length === 0) {
          setShowMoreMenu(false);
      }
  }, [selectedListIds]);

  // ========== Create, Update, Save a List ==========
  const handleCreateNewList = () => {
    setSelectedList(null);
    setListForm({ ...EMPTY_LIST });
    setListErrors({});
    setIsEditingList(true);
    setShowListForm(true);
    setItemText("");
  };

  const handleViewList = async (list) => {
    if (list.is_locked) {
      setSelectedList(list);
      setListForm({
        ...EMPTY_LIST,
        title: list.title || "",
        is_locked: true,
      });
      setListErrors({});
      setIsEditingList(false);
      setItemText("");
      setShowListForm(false);
      setshowUnlockPrompt(true);
      return;
    }
    setSelectedList(list);
    setListForm({
      title: list.title || "",
      items: normalizeItems(list.items),
      is_locked: Boolean(list.is_locked),
    });
    setListErrors({});
    setIsEditingList(false);
    setShowListForm(true);
    setItemText("");
    if (!Array.isArray(list.items)) {
      try {
        const response = await getListItems(list.id);
        const resData = getResponseData(response);
        const items = Array.isArray(resData) ? resData : Array.isArray(resData?.results) ? resData.results : Array.isArray(resData?.data) ? resData.data : [];
        setListForm((current) => ({
          ...current, items: normalizeItems(items),
        }));
        setSelectedList((current) =>
          current && String(current.id) === String(list.id) ? { ...current, items } : current
        );
      } catch (error) {
        console.error("Error loading checklist items:", error);
        showPopup("error", error.message || "Unable to load checklist items.");
      }
    }
  };
  const handleVerifySecurePassword = async (event) => {
    event.preventDefault();
    if (isVerifyingPassword) return;
    if (!securePassword.trim()) return setSecurePasswordError("Please enter your Card Lock Password.");
    setisVerifyingPassword(true);
    setSecurePasswordError("");
    try {
      const verifyResponse = await verifyCardLockPassword(securePassword);
      if (!verifyResponse || verifyResponse.status < 200 || verifyResponse.status >= 300) {
        throw new Error(verifyResponse?.data?.error || verifyResponse?.data?.detail || "Incorrect password. Please try again.");
      }
      if (secureAction === "copy" || secureAction === "send") {
        const pendingAction = secureAction;
        const pendingLists = getSelectedLists().filter((list) => secureActionListIds.some((id) => String(id) === String(list.id)));
        setshowUnlockPrompt(false);
        setSecurePassword("");
        setShowSecurePassword(false);
        setSecurePasswordError("");
        setSecureAction("");
        setSecureActionListIds([]);
        if (pendingAction === "copy") await copySelectedLists(pendingLists);
        else await sendSelectedLists(pendingLists);
        return;
      }
      if (!selectedList?.id) throw new Error("Unable to identify the secured list.");
      const listResponse = await getList(selectedList.id);
      if (!listResponse || listResponse.status < 200 || listResponse.status >= 300 || !listResponse.data) {
        throw new Error(listResponse?.data?.error || listResponse?.data?.detail || "Unable to open this list.");
      }
      const originalList = listResponse.data;
      setUnlockedListIds((prev) => prev.some((id) => String(id) === String(originalList.id)) ? prev : [...prev, originalList.id]);
      setSelectedList(originalList);
      setListForm({ title: originalList.title || "", items: normalizeItems(originalList.items), is_locked: Boolean(originalList.is_locked) });
      setListErrors({});
      setIsEditingList(false);
      setItemText("");
      setshowUnlockPrompt(false);
      setShowListForm(true);
      setSecurePassword("");
      setShowSecurePassword(false);
      setSecurePasswordError("");
    } catch (error) {
      console.error("Error verifying Card Lock Password:", error);
      setSecurePasswordError(error.message || "Unable to verify your password. Please try again.");
    } finally {
      setisVerifyingPassword(false);
    }
  };

  const handleEditList = () => {
    if (!selectedList || isSavingList) return;
    if (selectedList.is_locked && !isListUnlocked(selectedList)) {
      showPopup("error", "Unlock this list before editing.");
      return;
    }
    if (selectedList.is_archived || selectedList.is_deleted) {
      showPopup("error", "Restore this list before editing it.");
      return;
    }
    setIsEditingList(true);
    setListErrors({});
  };

  const handleListFormChange = (name, value) => {
    setListForm((current) => ({ ...current, [name]: value }));
    setListErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleListItemTextChange = (itemId, value) => {
    setListForm((current) => ({
      ...current, items: current.items.map((item) =>
        String(item.id) === String(itemId) ? { ...item, text: value } : item),
    }));
  };

  const handleClearListForm = () => {
    if (isSavingList) return;
    setListForm({ ...EMPTY_LIST });
    setListErrors({});
  };

  const handleCloseListForm = () => {
    if (isSavingList) return;
    if (selectedList?.id) {
      setUnlockedListIds((previous) => previous.filter((id) => String(id) !== String(selectedList.id)));
    }
    setSelectedList(null);
    setListForm({ ...EMPTY_LIST });
    setListErrors({});
    setIsEditingList(false);
    setShowListForm(false);
    setItemText("");
  };

  const addDraftItem = () => {
    const text = itemText.trim();
    if (!text) return;
    setListForm((current) => ({
      ...current,
      items: [...(current.items || []), { id: `draft-${Date.now()}-${Math.random()}`, text, is_completed: false, isDraft: true }],
    }));
    setItemText("");
  };

  const removeListItem = (itemId) => {
    setListForm((current) => ({ ...current, items: (current.items || []).filter((item) => String(item.id) !== String(itemId)) }));
  };

  const handleToggleItemCompletion = async (itemId) => {
    if (isSavingList) return;
    const item = (listForm.items || []).find((current) => String(current.id) === String(itemId));
    if (!item) return;
    const newCompletedStatus = !item.is_completed;
    if (isEditingList) {
      setListForm((current) => ({
        ...current,
        items: current.items.map((currentItem) => String(currentItem.id) === String(itemId) ? { ...currentItem, is_completed: newCompletedStatus } : currentItem),
      }));
      return;
    }
    if (!selectedList || (selectedList.is_locked && !isListUnlocked(selectedList))) return;
    setIsSavingList(true);
    try {
      getResponseData(await updateListItem(selectedList.id, itemId, { text: item.text, is_completed: newCompletedStatus }));
      const updatedItems = (listForm.items || []).map((currentItem) => String(currentItem.id) === String(itemId) ? { ...currentItem, is_completed: newCompletedStatus } : currentItem);
      setListForm((current) => ({ ...current, items: updatedItems }));
      setSelectedList((current) => current && String(current.id) === String(selectedList.id) ? { ...current, items: updatedItems } : current);
      setLists((current) => current.map((list) => String(list.id) === String(selectedList.id) ? { ...list, items: updatedItems } : list));
    } catch (error) {
      console.error("Error updating checklist item:", error);
      showPopup("error", error.message || "Unable to update checklist item.");
    } finally {
      setIsSavingList(false);
    }
  };

  // ========== Create, Update, Save a List ==========
  const handleSaveList = async (event) => {
    event.preventDefault();
    if (isSavingList || !isEditingList) return;
    if (selectedList?.is_locked && !isListUnlocked(selectedList)) {
      showPopup("error", "Unlock this list before editing.");
      return;
    }
    const trimmedTitle = listForm.title.trim();
    if (!trimmedTitle) {
      setListErrors({ title: "Please enter a list title." });
      return;
    }
    setIsSavingList(true);
    try {
      const items = listForm.items || [];
      let listId = selectedList?.id;
      if (selectedList) {
        getResponseData(await updateList(listId, { title: trimmedTitle, is_locked: Boolean(listForm.is_locked), is_pinned: selectedList.is_pinned, is_archived: selectedList.is_archived, is_deleted: selectedList.is_deleted }));
        const originalItems = Array.isArray(selectedList.items) ? selectedList.items : [];
        const currentItemIds = new Set(items.filter((item) => !item.isDraft).map((item) => String(item.id)));
        // Delete checklist items removed in the editor.
        for (const originalItem of originalItems) {
          if (!currentItemIds.has(String(originalItem.id))) {
            getResponseData(await deleteListItem(listId, originalItem.id));
          }
        }
        for (const item of items) {
          if (item.isDraft) {
            getResponseData(await createListItem(listId, { text: item.text.trim() }));
            continue;
          }
          const originalItem = originalItems.find((entry) => String(entry.id) === String(item.id));
          if (originalItem && (originalItem.text !== item.text || Boolean(originalItem.is_completed) !== Boolean(item.is_completed))) {
            getResponseData(await updateListItem(listId, item.id, { text: item.text.trim(), is_completed: Boolean(item.is_completed) }));
          }
        }
      } else {
        const createdList = getResponseData(await createList({ title: trimmedTitle, is_locked: Boolean(listForm.is_locked) }));
        listId = createdList?.id;
        if (listId == null) throw new Error("The server did not return the new list ID.");
        for (const item of items) {
          getResponseData(await createListItem(listId, { text: item.text.trim() }));
        }
      }
      await fetchLists();
      showPopup("success", selectedList ? "List updated successfully." : "List created successfully.");
      setSelectedList(null);
      setSelectedListIds([]);
      setListForm({ ...EMPTY_LIST });
      setListErrors({});
      setIsEditingList(false);
      setShowListForm(false);
      setItemText("");
    } catch (error) {
      console.error("Error saving list:", error);
      showPopup("error", error.message || "Unable to save the list.");
    } finally {
      setIsSavingList(false);
    }
  };

  // ========== Open List from Navigation ==========
  useEffect(() => {
    const state = location.state || {};
    const requestedListId = state.editListId ?? state.listId;
    const shouldEdit = Boolean(state.openForEdit || state.editListId != null);
    const fromArchive = Boolean(state.fromArchive);
    if (requestedListId == null || isLoadingLists || loadError) return;
    let cancelled = false;
    const openSelectedList = async () => {
      let list = lists.find((item) => String(item.id) === String(requestedListId));
      if (!list && fromArchive) {
        try {
          const response = await getArchivedLists();
          if (cancelled) return;
          if (response?.status >= 200 && response.status < 300) {
            const resData = getResponseData(response);
            const archivedLists = Array.isArray(resData) ? resData : Array.isArray(resData?.results) ? resData.results : Array.isArray(resData?.data) ? resData.data : [];
            list = archivedLists.find((item) => String(item.id) === String(requestedListId));
          }
        } catch (error) {
          console.error("Error loading archived list:", error);
        }
      }
      if (cancelled) return;
      navigate(location.pathname, { replace: true, state: null });
      if (!list) {
        showPopup("error", "Unable to find the selected list.");
        return;
      }
      if (list.is_locked) {
        showPopup("error", "This list is secured. Unlock it before editing.");
        return;
      }
      if (list.is_locked && shouldEdit) {
        await handleViewList(list);
        return;
      }
      await handleViewList(list);
      if (shouldEdit && !list.is_locked && !list.is_archived && !list.is_deleted) setIsEditingList(true);
    };
    openSelectedList();
    return () => { cancelled = true; };
  }, [location.state, location.pathname, lists, isLoadingLists, loadError, navigate, showPopup]);


  // ========== Date Formatting ==========
  const formatDate = (datevalue) => {
    if (!datevalue) return "Recently updated";
    const date = new Date(datevalue);
    if (Number.isNaN(date.getTime())) return "Recently updated";
    return date.toLocaleDateString("en-IN", {day: "numeric", month: "short", year: "numeric"});
  };

  // ========== Handling list Secure ==========
  const handleToggleListLock = () => {
    if (listForm.is_locked) {
      handleListFormChange("is_locked", false);
      return;
    }
    if (!cardLockPasswordSet) {
      setShowSecurePrompt(true);
      return;
    }
    handleListFormChange("is_locked", true);
  };

  // ========== Secure List Card Title ==========
  const getPrivateListTitle = (list) => {
      const lockedLists = sortedLists.filter((item) => item.is_locked).sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime();
          const dateB = new Date(b.created_at || 0).getTime();
          return dateA - dateB || Number(a.id) - Number(b.id);
      });
      const actualTitle = String(list.title || "").trim();
      if (/\bcopy(?:\s+\(\d+\))?$/i.test(actualTitle)) {
          const safeCopyMatch = actualTitle.match(/^Private Lists \((\d+)\)( copy(?: \(\d+\))?)$/i);
          if (safeCopyMatch) return `Private Lists (${safeCopyMatch[1]})${safeCopyMatch[2]}`;
      }
      const index = lockedLists.findIndex((item) => String(item.id) === String(list.id));
      return `Private Lists (${index + 1})`;
  };

  // ========== Render List Card ==========
  const renderListCard = (list) => {
    const selected = isListSelected(list.id);
    const isLocked = Boolean(list.is_locked);
    const displayTitle = isLocked ? getPrivateListTitle(list) : list.title || "Untitled list";
    const items = isLocked ? [] : list.items || [];
    const completedCount = items.filter((item) => item.is_completed).length;
    const progress = items.length ? Math.round((completedCount / items.length) * 100) : 0;
    const securedMessage = "This list's content is secured.";
    return viewMode === "list" ? (
    <article className={`list-card list-card-list ${list.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={list.id} onClick={() => handleViewList(list)}>
        <div className="lists-list-left">
          <div className="lists-list-top">
            <label className="select-label" onClick={(e) => e.stopPropagation()} title="Select list">
              <input type="checkbox" className="select-checkbox" checked={selected} onChange={(e) => toggleListSelection(e, list.id)} aria-label={`Select ${displayTitle}`} disabled={isSavingList || selectedList?.is_locked || (isEditingList && Boolean(selectedList?.id))} />
              <span className="select-checkmark" />
            </label>
          </div>
          <button type="button" className="lists-card-main" onClick={() => handleViewList(list)}>
            <div className="lists-title-row">
              <h3 className="lists-card-title" title={displayTitle}>{displayTitle}</h3>
              <span className="lists-card-date">{formatDate(list.updated_at || list.created_at)}</span>
            </div>
            {isLocked ? (
              <p className="lists-no-items">{securedMessage}</p>
            ) : (
              <>
                <div className="lists-progress-label">
                  <span>{completedCount} of {items.length} completed</span>
                  <span>{progress}%</span>
                </div>
                <div className="lists-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${displayTitle} completion`}>
                  <div className="lists-progress-fill" style={{ width: `${progress}%` }} />
                </div>

                <div className="lists-items-inline">
                  {items.length === 0 ? (
                    <span className="lists-no-items">No checklist items yet.</span>
                  ) : (
                    <>
                      {items.slice(0, 3).map((item) => (
                        <span className="lists-item-preview" key={item.id}>
                          <i className={`fa-regular ${item.is_completed ? "fa-circle-check completed" : "fa-circle"}`} />
                          {isEditingList ? (
                            <input type="text" className="lists-editor-item-input" value={item.text} onChange={(e) => handleListItemTextChange(item.id, e.target.value)} placeholder="Enter checklist item" aria-label="Edit checklist item" disabled={isSavingList || (selectedList?.is_locked && !isListUnlocked(selectedList))} />
                          ) : (
                            <span className={item.is_completed ? "completed" : ""}>{item.text}</span>
                          )}
                        </span>
                      ))}
                      {items.length > 3 && <span className="lists-more-items">+{items.length - 3} more</span>}
                    </>
                  )}
                </div>
              </>
            )}
          </button>
        </div>
        <div className="lists-card-icons">
          <button type="button" className={`common-pin-button ${list.is_pinned ? "pinned" : ""}`} title={list.is_pinned ? "Unpin list" : "Pin list"} aria-label={list.is_pinned ? "Unpin list" : "Pin list"} aria-pressed={Boolean(list.is_pinned)} onClick={(e) => handleTogglePin(e, list)} disabled={isProcessingAction}>
            <i className={`fa-solid ${actionListId === list.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
          </button>
          {isLocked && <i className="fa-solid fa-lock" title="Secured list" aria-label="Secured list" />}
        </div>
      </article>
    ) : (
      <article className={`list-card ${list.is_pinned ? "is-pinned" : ""} ${selected ? "selected" : ""}`} key={list.id} onClick={() => handleViewList(list)}>
        <div className="lists-card-header">
          <div className="lists-card-title-area">
            <label className="select-label" onClick={(e) => e.stopPropagation()} title="Select list">
              <input type="checkbox" className="select-checkbox" checked={selected} onChange={(e) => toggleListSelection(e, list.id)} aria-label={`Select ${displayTitle}`} disabled={isSavingList || selectedList?.is_locked || (isEditingList && Boolean(selectedList?.id))} />
              <span className="select-checkmark" />
            </label>
            <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayTitle}>{displayTitle}</h3>
          </div>
          <div className="lists-card-icons">
            <button type="button" className={`common-pin-button ${list.is_pinned ? "pinned" : ""}`} title={list.is_pinned ? "Unpin list" : "Pin list"} aria-label={list.is_pinned ? "Unpin list" : "Pin list"} aria-pressed={Boolean(list.is_pinned)} onClick={(e) => handleTogglePin(e, list)} disabled={isProcessingAction}>
              <i className={`fa-solid ${actionListId === list.id && isProcessingAction ? "fa-bookmark" : "fa-thumbtack"}`} />
            </button>
            {isLocked && <i className="fa-solid fa-lock" title="Secured list" aria-label="Secured list" />}
          </div>
        </div>
        {isLocked ? (
          <div className="lists-items-preview"><p className="lists-no-items">{securedMessage}</p></div>
        ) : (
          <>
            <div className="lists-progress">
              <div className="lists-progress-label">
                <span>{completedCount} of {items.length} completed</span>
                <span>{progress}%</span>
              </div>
              <div className="lists-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${displayTitle} completion`}>
                <div className="lists-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="lists-items-preview">
              {items.length === 0 ? (
                <p className="lists-no-items">No checklist items yet.</p>
              ) : (
                <>
                  {items.slice(0, 3).map((item) => (
                    <div className="lists-item-preview" key={item.id}>
                      <i className={`fa-regular ${item.is_completed ? "fa-circle-check completed" : "fa-circle"}`} />
                      {isEditingList ? (
                        <input type="text" className="lists-editor-item-input" value={item.text} onChange={(e) => handleListItemTextChange(item.id, e.target.value)} placeholder="Enter checklist item" aria-label="Edit checklist item" disabled={isSavingList || (selectedList?.is_locked && !isListUnlocked(selectedList))} />
                      ) : (
                        <span className={item.is_completed ? "completed" : ""}>{item.text}</span>
                      )}
                    </div>
                  ))}
                  {items.length > 3 && <p className="lists-more-items">+{items.length - 3} more</p>}
                </>
              )}
            </div>
          </>
        )}
        <div className="lists-card-footer">
          <span>{formatDate(list.updated_at || list.created_at)}</span>
          <span>{isLocked ? "Secured" : "Checklist"}</span>
        </div>
      </article>
    );
  };

  // ========== Render Lisk Section ==========
  const renderListSection = (sectionLists, sectionTitle) => (
    <section className="common-group" key={sectionTitle}>
      <div className="common-group-heading">
        <h2><i className={`fa-solid ${sectionTitle === "Pinned" ? "fa-thumbtack" : "fa-list-check"}`}/>{sectionTitle}</h2>
        <span>{sectionLists.length}</span>
      </div>
      <div className={`lists-grid ${viewMode === "list" ? "list-view" : ""}`}>{sectionLists.map(renderListCard)}</div>
    </section>
  );

  // ========== Loading State ==========
  if (isLoadingLists) return <Loader message="Loading your lists..." />;
  if (loadError) {
    return (
      <main className="common-page">
        <div className="common-error-state" role="alert">
          <i className="fa-solid fa-cloud-bolt" />
          <h2>Unable to load lists</h2>
          <p>{loadError}</p>
          <button type="button" className="common-create-button" onClick={fetchLists}><i className="fa-solid fa-rotate-right" />Retry</button>
          <button type="button" className="common-error-back-button" onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
        </div>
      </main>
    );
  }


  // ========== Main List Page ==========
  return (
    <main className="common-page">
      <header className="common-header">
        <div className="common-header-left">
          <button type="button" className="common-back-button" onClick={() => navigate("/dashboard")} title="Back to dashboard" aria-label="Back to dashboard">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <h1>Lists</h1>
        </div>
        <button type="button" className="common-create-button" onClick={handleCreateNewList}>
          <i className="fa-solid fa-plus" /> <span>New List</span>
        </button>
      </header>
      <section className="common-content">
        {sortedLists.length > 0 && (
          <div className="common-toolbar">
            <div className="common-toolbar-left">
              <label className="common-sort-label">
                <i className="fa-solid fa-arrow-down-wide-short" />
                <select className="common-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort lists">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title-asc">Title A - Z</option>
                  <option value="title-desc">Title Z - A</option>
                </select>
              </label>
              <span className="common-count">{sortedLists.length}{" "}{sortedLists.length === 1 ? "list" : "lists"}</span>
              <button type="button" className="common-select-all-button" onClick={handleToggleSelectAll} aria-pressed={allListsSelected}>{allListsSelected ? "Deselect all" : "Select all"}</button>
            </div>
            <div className="common-toolbar-right">
              {selectedListIds.length > 0 && (
                <>
                  <span className="common-selection-count">{selectedListIds.length} selected</span>
                  <button type="button" className="common-bulk-delete-button" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting || isProcessingAction}>
                    <i className="fa-regular fa-trash-can" /><span>Move to Trash</span>
                  </button>
                </>
              )}
              <div className="common-toolbar-actions">
                <div className="common-view-toggle" aria-label="List view">
                  <button type="button" className={viewMode === "grid" ? "pinned" : ""} onClick={() => setViewMode("grid")} title="Grid view" aria-label="Grid view" aria-pressed={viewMode === "grid"}>
                    <i className="fa-solid fa-grip" />
                  </button>
                  <button type="button" className={viewMode === "list" ? "pinned" : ""} onClick={() => setViewMode("list")} title="List view" aria-label="List view" aria-pressed={viewMode === "list"}>
                    <i className="fa-solid fa-list" />
                  </button>
                </div>
                {selectedListIds.length > 0 && (
                  <div className="common-more-container">
                      <button type="button" className="common-more-button" title="More actions" aria-label="More list actions" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu((previous) => !previous)}>
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
        {sortedLists.length === 0 ? (
          <div className="common-empty">
            <i className="fa-solid fa-list-check" aria-hidden="true" />
            <h2>No lists yet</h2>
            <p>Create your first list to get started.</p>
          </div>
        ) : (
          <div className="common-sections">
            {pinnedLists.length > 0 && renderListSection(pinnedLists, "Pinned")}
            {pinnedLists.length > 0 && unpinnedLists.length > 0 && (<div className="common-section-divider"><span /></div>)}
            {unpinnedLists.length > 0 && renderListSection(unpinnedLists, "Others")}</div>
        )}
      </section>

      {/* Create, view, or edit list modal */}
      {showListForm && (
        <div className="lists-form-overlay" onMouseDown={(event) => event.target === event.currentTarget && !isSavingList && handleCloseListForm()}>
          <form className="list-form" onSubmit={handleSaveList} role="dialog" aria-modal="true" aria-labelledby="lists-form-title">
            <div className="lists-form-header">
              <div>
                <h2 id="lists-form-title">{selectedList ? selectedList.is_locked && !isEditingList && !unlockedListIds.some((id) => String(id) === String(selectedList.id)) ? getPrivateListTitle(selectedList) : isEditingList ? "Edit list" : "View list" : "Create list"}</h2>
                <p>{selectedList ? selectedList.is_locked && !isEditingList && !unlockedListIds.some((id) => String(id) === String(selectedList.id)) ? "This list's content is secured. Verify your Card Lock Password to view it." : isEditingList ? "Update your list and checklist items." : "View your checklist and completion progress." : "Create a list and add your checklist items."}</p>
              </div>
              <div className="lists-detail-actions">
                {selectedList && !isEditingList && (
                  <button type="button" className="edit-icon-button" title="Edit list" aria-label="Edit list" onClick={handleEditList} disabled={isSavingList || (selectedList.is_locked && !isListUnlocked(selectedList))}>
                    <i className="fa-solid fa-pen" />
                  </button>
                )}
                {isEditingList && (
                  <button type="button" className={`lock-button ${listForm.is_locked ? "locked" : ""}`} onClick={handleToggleListLock} disabled={isSavingList} aria-pressed={listForm.is_locked}>
                      <i className={listForm.is_locked ? "fa-solid fa-lock" : "fa-solid fa-lock-open"} />
                      <span>{listForm.is_locked ? "Secured" : "Open"}</span>
                  </button>
                )}
                <button type="button" className="close-icon-button" onClick={handleCloseListForm} disabled={isSavingList} aria-label="Close list">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <div className="lists-form-body">
              {selectedList?.is_locked && !isListUnlocked(selectedList) ? (
                <div className="lists-secured-content">
                  <i className="fa-solid fa-lock" aria-hidden="true" />
                  <h3>Private List</h3>
                  <p>This list's title and checklist items are secured.</p>
                  <p>Verify your Card Lock Password to view the content.</p>
                </div>
              ) : (
              <>
                <div className="lists-title-field">
                  <label className="list-title" htmlFor="lists-title-input">List title</label>
                  <input id="lists-title-input" name="title" className="lists-title-input" value={listForm.title} onChange={(event) => handleListFormChange("title", event.target.value)} placeholder="e.g. Weekly goals" maxLength={200} autoFocus required readOnly={!isEditingList} disabled={isSavingList} />
                  {isEditingList && listErrors.title && (<p className="field-error">{listErrors.title}</p>)}
                </div>
                <div className="lists-editor-items">
                  <div className="lists-editor-header">
                    <h3>Checklist items</h3>
                  </div>
                  {(listForm.items || []).length === 0 ? (
                    <p className="lists-no-items">{isEditingList ? "No checklist items. Add your first item below." : "No checklist items yet."}</p>
                  ) : (
                    <div className="lists-editor-items-list">
                      {(listForm.items || []).map((item) => (
                        <div className="lists-editor-item" key={item.id}>
                          <label className="lists-editor-item-content">
                            <input type="checkbox" checked={Boolean(item.is_completed)} disabled={isSavingList || (selectedList?.is_locked && !isListUnlocked(selectedList))}onChange={() => handleToggleItemCompletion(item.id)} aria-label={`Mark ${item.text} as ${item.is_completed ? "incomplete" : "complete"}`}/>
                            {isEditingList ? (
                              <input type="text" className="lists-editor-item-input" value={item.text} onChange={(event) => handleListItemTextChange(item.id, event.target.value)} placeholder="Enter checklist item" aria-label="Edit checklist item" disabled={isSavingList || (selectedList?.is_locked && !isListUnlocked(selectedList))}/>
                            ) : (
                              <span className={item.is_completed ? "completed" : ""}>{item.text}</span>
                            )}
                          </label>
                          {isEditingList && (
                            <button type="button" onClick={() => removeListItem(item.id)} aria-label={`Remove ${item.text}`} disabled={isSavingList}>
                              <i className="fa-solid fa-xmark" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {isEditingList && (
                    <div className="lists-editor-add">
                      <input value={itemText} onChange={(event) => setItemText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), addDraftItem())} placeholder="Add a checklist item..." aria-label="New checklist item" disabled={isSavingList} />
                      <button type="button" onClick={addDraftItem} disabled={!itemText.trim() || isSavingList} aria-label="Add checklist item"><i className="fa-solid fa-plus" /></button>
                    </div>
                  )}
                </div>
                <div className="lists-detail-footer">
                  <span>{(listForm.items || []).filter((item) => item.is_completed).length}{" "}of {(listForm.items || []).length}{" "}completed</span>
                  {(listForm.items || []).length > 0 && (
                    <span>{Math.round(((listForm.items || []).filter((item) => item.is_completed).length /(listForm.items || []).length) *100)}% complete</span>
                  )}
                </div>
                {listForm.is_locked && (<p className="locked-message"><i className="fa-solid fa-lock" /> This List is marked as secured.</p>)}
              </>
              )}
            </div>
            <div className="form-actions">
              {isEditingList ? (
                <>
                  <button type="button" className="clear-button" onClick={handleClearListForm} disabled={isSavingList}>
                    <i className="fa-solid fa-eraser" /><span>Clear</span>
                  </button>
                  <button type="button" className="cancel-button" onClick={handleCloseListForm} disabled={isSavingList}>
                    <i className="fa-solid fa-ban"></i><span>Cancel</span>
                  </button>
                  <button type="submit" className="save-button" disabled={isSavingList || !listForm.title.trim()}>
                    <i className={`fa-solid ${isSavingList ? "fa-spinner fa-spin" : "fa-check"}`} />
                    <span>{isSavingList ? "Saving..." : selectedList ? "Save Changes" : "Save List"}</span>
                  </button>
                </>
              ) : (
                <button type="button" className="cancel-button" onClick={handleCloseListForm} disabled={isSavingList}>
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
                  <p>First add a Card Lock Password, then come back to secure your list.</p>
                  <div className="modal-actions">
                      <button type="button" className="save-button" onClick={() => {navigate("/account", {state: { focusCardLockPassword: true },});}}>Add Password</button>
                      <button type="button" className="cancel-button" onClick={() => setShowSecurePrompt(false)}>Cancel</button>
                  </div>
              </div>
          </div>
      )}

      {/* Unlock Secured List */}
      {showUnlockPrompt && (
        <div className="modal-overlay" onMouseDown={(e) => {if (e.target === e.currentTarget && !isVerifyingPassword) {setshowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setShowSecurePassword(false); setSecureAction(""); setSecureActionListIds([]); setSelectedList(null);}}}>
          <form className="modal-content secure-password-prompt" role="dialog" aria-modal="true" aria-labelledby="unlock-list-title" onSubmit={handleVerifySecurePassword}>
            <h2 id="unlock-list-title">{secureAction === "copy" ? "Verify Password to Copy" : secureAction === "send" ? "Verify Password to Send" : "Unlock Private List"}</h2>
            <p>{secureAction === "copy" ? "Enter your Card Lock Password to copy the selected secured lists." : secureAction === "send" ? "Enter your Card Lock Password to send the selected secured lists." : "Enter your Card Lock Password to view this list."}</p>
            <div className="modal-field">
              <label className="password-title" htmlFor="unlock-note-password">Card Lock Password</label>
              <div className="password-input-wrapper">
                <input id="unlock-list-password" type={showSecurePassword ? "text" : "password"} value={securePassword} onChange={(e) => { setSecurePassword(e.target.value); setSecurePasswordError(""); }} placeholder="Enter your password" autoComplete="current-password" autoFocus disabled={isVerifyingPassword} />
                <button type="button" className="password-toggle-button" onClick={() => setShowSecurePassword((prev) => !prev)} aria-label={showSecurePassword ? "Hide password" : "Show password"} title={showSecurePassword ? "Hide password" : "Show password"} disabled={isVerifyingPassword}>
                  <i className={showSecurePassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                </button>
              </div>
            </div>
            {securePasswordError && <p className="modal-field-error" role="alert">{securePasswordError}</p>}
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => {if (isVerifyingPassword) return; setshowUnlockPrompt(false); setSecurePassword(""); setSecurePasswordError(""); setShowSecurePassword(false); setSecureAction(""); setSecureActionListIds([]); setSelectedList(null);}} disabled={isVerifyingPassword}>Cancel</button>
              <button type="submit" className="save-button" disabled={isVerifyingPassword || !securePassword.trim()}>{isVerifyingPassword ? "Verifying..." : "Unlock List"}</button>
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
            {/* Icon Wrapper */}
            <div className="delete-confirm-icon"><i className="fa-regular fa-trash-can" /></div>
            <h3 id="bulk-delete-title">Move selected lists to Trash?</h3>
            <p>You are about to move <strong>{selectedListIds.length} {selectedListIds.length === 1 ? "list" : "lists"}</strong> to Trash. You can restore them later if your application provides a Trash restore workflow.</p>
            {/* Operational Trigger Group */}
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

export default Lists;