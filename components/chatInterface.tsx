"use client";

import { Id, Doc } from "@/convex/_generated/dataModel";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { ChatRequestBody } from "@/lib/types";

interface chatInterfaceProps {
    chatId: Id<"chats">;
    initialMessages: Doc<"messages">[];
}
const chatInterfaceProps = ({ chatId, initialMessages }: chatInterfaceProps) => {
    const [messages, setMessages] = useState<Doc<"messages">[]>(initialMessages);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [streamedResponse, setStreamResponse] = useState("");
    const [currentTool, setCurrentTool] = useState<{
        name: string;
        input: unknown;
    } | null>(null);

    const messageEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, streamedResponse]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;
        setIsLoading(true);
        setInput("");
        setCurrentTool(null);
        setStreamResponse("");

        const optimisticUserMessage: Doc<"messages"> = {
            _id: `temp_${Date.now()}`,
            chatId,
            content: trimmedInput,
            role: "user",
            createdAt: Date.now(),
        } as Doc<"messages">;

        setMessages((prev) => [...prev, optimisticUserMessage])

        let fullResponse = "";
        try {
            const requestBody: ChatRequestBody = {
                messages: messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                })),
                newMessage: trimmedInput,
                chatId,
            }

            const response = await fetch("api/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            })

            if (!response.ok) throw new Error(await response.text());
            if (!response.body) throw new Error("No response body available");
        } catch (error) {
            console.log("Error sending message:", error);
            setMessages((prev) =>
                prev.filter((msg) => msg._id !== optimisticUserMessage._id)
            );
            setStreamResponse("error");
        } finally {
            setIsLoading(false);
        }
    }
    return (
        <main className="flex flex-col h-[calc(100vh-theme(spacing.14))]">
            {/* Message */}
            <section className="flex-1">
                <div>
                    {/* Last Message */}
                    <div ref={messageEndRef} />
                </div>
            </section>
            <footer className="border-t bg-white p-4">
                <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
                    <div className="relative flex items-center">
                        <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                            className="flex-1 py-3 px-4 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500
                    focus:border-transparent pr-12 bg-gray-50 placeholder:text-gray-500" disabled={isLoading}
                            placeholder="Ask a question..." />
                        <Button type="submit" className={`absolute right-1.5 rounded-xl h-9 w-9 p-0 flex items-center justify-center transition-all
                        ${input.trim() ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm" : "bg-gray-100 text-gray-400"}`}
                            disabled={isLoading || !input.trim()}>
                            <ArrowRight />
                        </Button>
                    </div>
                </form>
            </footer>
        </main>
    )
}

export default chatInterfaceProps