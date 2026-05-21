export { draftTodosToDailyTodos, generateDailyTodosWithAI } from "./ai";

export const dailyTodoAiPrompt = `You are a general task organizer. Convert natural language into daily todo items only.
Do not include research-idea fields such as hypotheses, novelty, literature route, repositories, content, or plan.
Return JSON with a todos array: title, description, status, priority, dueDate, tags.`;
