import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const geminiKey = req.headers.get("x-gemini-key");
    if (!geminiKey) return NextResponse.json({ error: "No API key" }, { status: 401 });

    const { messages, system } = body;

    // Convert messages to Gemini format
    const contents = messages.map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const geminiBody: any = {
      contents,
      generationConfig: { maxOutputTokens: 800, temperature: 0.9 },
    };

    if (system) {
      geminiBody.systemInstruction = { parts: [{ text: system }] };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(geminiBody),
      }
    );

    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.error?.message || "Gemini error" }, { status: res.status });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return NextResponse.json({ error: "Empty response" }, { status: 500 });

    // Return in same format as before so frontend doesn't change
    return NextResponse.json({ content: [{ text }] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
