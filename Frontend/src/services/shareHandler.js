export const shareContent = async (title, text) => {
    if (navigator.share) {
        try {
            await navigator.share({
                title,
                text,
            });

            return {
                success: true,
                method: "share",
            };
        } catch (error) {
            if (error.name === "AbortError") {
                return {
                    success: false,
                    cancelled: true,
                };
            }

            return {
                success: false,
                error: "Unable to share content.",
            };
        }
    }

    try {
        await navigator.clipboard.writeText(text);

        return {
            success: true,
            method: "clipboard",
        };
    } catch (error) {
        return {
            success: false,
            error: "Unable to copy content.",
        };
    }
};