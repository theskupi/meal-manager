# Smart Meal Planner & Automated Kitchen Assistant (aka PapiPap)

A personalized, AI-driven meal planning and inventory tracking system. This project automates grocery listing, dynamic macro tracking, and flexible meal adjustments through a chat interface, acting as a smart layer between your favorite cookbooks and a shared family dashboard.

## 🚀 Key Features

- **AI Recipe Ingestion (Vision):** Snap a photo of any cookbook page; the system extracts ingredients, structured steps, and metrics via LLM Vision APIs to automatically populate the database.
- **Dynamic Calendar & Portion Shifting:** Algorithms that handle real-life changes. Skip a meal or dine out, and the system automatically recalculates portions and cascades the remaining menu to the following days.
- **Smart Inventory & "Leftovers" Generator:** Keeps a real-time log of pantry stock. Generates custom recipes based on ingredients that are about to expire.
- **Automated Grocery Lists & Alerts:** Compares upcoming weekly meal requirements against current pantry stock to generate an optimized shopping list, sending automated restock notifications when essentials run low.
- **Chat-Based Interface:** Query the schedule ("What's for dinner tomorrow?"), adjust plans via natural language, or add ingredients directly through a mobile-friendly chat bot.
- **Macro & Kcal Balancer (Nice-to-Have):** Integrates food composition APIs to calculate nutritional values and dynamically adjusts portion sizes to match daily caloric targets.

## 🛠️ Tech Stack & Architecture

- **Backend:** Node.js with TypeScript
- **User Interface & Dashboard:** Notion (serving as a shared family database, calendar, and visual recipe gallery via the Notion API)
- **Frontend Interaction:** Telegram Bot API (for quick natural language queries, photo uploads, and notifications)
- **AI & LLM Orchestration:**
  - **Groq API (Llama 3):** For lightning-fast, cost-effective text processing, natural language adjustments, and JSON schema enforcement.
  - **OpenAI API (GPT-4o-mini) / Google Gemini API:** For advanced multi-modal vision tasks (parsing cookbook photos).
- **Nutritional Data:** Edamam API / Open Food Facts API
