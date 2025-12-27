import { GoogleGenAI } from "@google/genai";

export const getCoachingTip = async (prompt: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
        return "Gemini API key not configured. Please set VITE_GEMINI_API_KEY in .env.local.";
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        // Use 'gemini-3-flash-preview' for basic text tasks (coaching tips)
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt
        });
        
        // Directly access the .text property of the GenerateContentResponse object.
        return response.text || "No advice available.";

    } catch (error) {
        console.error("Error fetching coaching tip from Gemini API:", error);
        return "Sorry, I ran into an error getting advice. Please check the console for details.";
    }
};