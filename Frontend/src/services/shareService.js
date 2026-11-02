const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
export const shareNote = async (noteId) => {
    const response = await fetch(
        `${API_BASE_URL}/notes/${noteId}/share/`,
        {
            method: "POST",
            credentials: "include",
        }
    );

    const data = await response.json();

    return {
        status: response.status,
        data,
    };
};


export const shareList = async (listId) => {
    const response = await fetch(
        `${API_BASE_URL}/lists/${listId}/share/`,
        {
            method: "POST",
            credentials: "include",
        }
    );

    const data = await response.json();

    return {
        status: response.status,
        data,
    };
};


export const shareTask = async (taskId) => {
    const response = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/share/`,
        {
            method: "POST",
            credentials: "include",
        }
    );

    const data = await response.json();

    return {
        status: response.status,
        data,
    };
};