export const formatNoteForShare = (note) => {
    return `${note.title}

${note.content}`;
};


export const formatListForShare = (focusList) => {
    const items = focusList.items
        .map((item) => {
            const checkbox = item.is_completed ? "✓" : "○";
            return `${checkbox} ${item.text}`;
        })
        .join("\n");

    return `${focusList.title}

${items}`;
};


export const formatTaskForShare = (task) => {
    return `${task.title}

Description: ${task.description || "No description"}
Assigned to: ${task.assigned_to || "Not assigned"}
Priority: ${task.priority}
Status: ${task.status}
Due date: ${task.due_date || "No due date"}`;
};