import { GoogleGenAI } from "@google/genai";

export const getCoachingTip = async (prompt: string): Promise<string> => {
    // The API key must be obtained exclusively from the environment variable process.env.API_KEY.
    // Create a new GoogleGenAI instance right before making an API call.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return "Gemini API key not configured. Please set the API_KEY environment variable.";
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