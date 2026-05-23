import Groq from 'groq-sdk';
import { config } from '../config';

export interface ParsedIntent {
  intent:
    | 'add_pantry'
    | 'remove_pantry'
    | 'query_schedule'
    | 'skip_meal'
    | 'query_pantry'
    | 'unknown';
  params: Record<string, unknown>;
}

const REPAIR_MODEL = 'llama-3.3-70b-versatile';
const INTENT_MODEL = 'llama-3.3-70b-versatile';

const client = new Groq({ apiKey: config.groq.apiKey });

export async function repairJson(rawText: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: REPAIR_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a JSON repair assistant. The user will provide broken or incomplete JSON. ' +
          'Return ONLY the corrected, valid JSON — no explanation, no markdown, no code fences.',
      },
      {
        role: 'user',
        content: `Fix this JSON:\n\n${rawText}`,
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? rawText;
}

export async function parseIntent(text: string): Promise<ParsedIntent> {
  const completion = await client.chat.completions.create({
    model: INTENT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an intent parser for a multilingual meal planning kitchen assistant. ' +
          'The user may write in any language. Always return English param keys and English-normalised values.\n\n' +
          'Return a JSON object with "intent" (string) and "params" (object). Return ONLY valid JSON, no explanation, no markdown.\n\n' +
          'Intents and their required params:\n' +
          '- add_pantry: {"name": <string>, "quantity": <number>, "unit": <one of: g,kg,ml,l,cup,tbsp,tsp,piece,slice,other>, "expiryDate": <YYYY-MM-DD string or null>}\n' +
          '- remove_pantry: {"name": <string>}\n' +
          '- query_pantry: {"query_type": "list" | "expiry"}\n' +
          '- query_schedule: {"date": <YYYY-MM-DD or "today" or "tomorrow" or null>}\n' +
          '- skip_meal: {"date": <YYYY-MM-DD or "today" or "tomorrow">, "meal_type": <"breakfast"|"lunch"|"dinner">}\n' +
          '- unknown: {}\n\n' +
          'For dates, always convert to YYYY-MM-DD format regardless of the input format (e.g. "20.3.2029" → "2029-03-20").\n' +
          'For units, map common words to the enum (e.g. "gram"/"gramy"/"g" → "g", "kus"/"piece"/"ks" → "piece").',
      },
      { role: 'user', content: text },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{"intent":"unknown","params":{}}';

  try {
    const parsed = JSON.parse(raw) as ParsedIntent;
    return parsed;
  } catch {
    return { intent: 'unknown', params: {} };
  }
}
