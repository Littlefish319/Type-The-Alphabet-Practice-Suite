import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getAi = () => {
    if (!ai) {
        if (process.env.API_KEY) {
            ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        } else {
            console.error("API_KEY environment variable not set.");
        }
    }
    return ai;
};

export const getCoachingTip = async (prompt: string): Promise<string> => {
    const genAI = getAi();
    if (!genAI) {
        return "Gemini API key not configured. Please set the API_KEY environment variable.";
    }

    try {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: prompt }] }]
        });
        
        // Ensure we always return a string, even if response.text is undefined
        return response.text || "No advice available.";

    } catch (error) {
        console.error("Error fetching coaching tip from Gemini API:", error);
        return "Sorry, I ran into an error getting advice. Please check the console for details.";
    }
};