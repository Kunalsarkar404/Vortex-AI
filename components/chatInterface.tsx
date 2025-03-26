"use client";

import { Id, Doc } from "@/convex/_generated/dataModel";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { ChatRequestBody, StreamMessageType } from "@/lib/types";
import { createSSEParser } from "@/lib/createSSEParser";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import MessageBubble from "./MessageBubble";
import WelcomeMessage from "./WelcomeMessage";

interface chatInterfaceProps {
    chatId: Id<"chats">;
    initialMessages: Doc<"messages">[];
}
const ChatInterface = ({ chatId, initialMessages }: chatInterfaceProps) => {
    const [messages, setMessages] = useState<Doc<"messages">[]>(initialMessages);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [streamedResponse, setStreamedResponse] = useState("");
    const [currentTool, setCurrentTool] = useState<{
        name: string;
        input: unknown;
    } | null>(null);

    const messageEndRef = useRef<HTMLDivElement>(null);

    const formatToolOutput = (output: unknown): string => {
        if (typeof output === "string") {
            return output;
        }
        return JSON.stringify(output, null, 2);
    }

    const formatTerminalOutput = (
        tool: string,
        input: unknown,
        output: unknown
    ) => {
        const terminalHtml = `<div class="bg-[#1e1e1e] text-white font-mono p-2 rounded-md my-2 overflow-x-auto whitespace-normal max-w-[600px]">
        <div class="flex items-center gap-1.5 border-b border-gray-700 pb-1">
            <div class="w-2 h-2 bg-blue-500 rounded-full"></div>
            ${tool}
        </div>
        <div class="text-gray-400 mt-1">$ input</div>
        <pre class="text-gray-700 mt-0.5 whitespace-pre-wrap overflow-x-auto">${formatToolOutput(input)}</pre>
        <div class="text-gray-400 mt-2">$ output</div>
        <pre class="text-gray-600 mt-0.5 whitespace-pre-wrap overflow-x-auto">${formatToolOutput(output)}</pre>
        </div>`;

        return `---START---\n${terminalHtml}\n---END---`;
    }

    const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>, onChunk: (chunk: string) => Promise<void>) => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = new TextDecoder().decode(value);
                await onChunk(chunk);
            }
        }
        catch (error) {
            console.error("Error processing stream:", error);
        } finally {
            reader.releaseLock();
        }
    }

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
        setStreamedResponse("");

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

            const response = await fetch("/api/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            })

            if (!response.ok) throw new Error(await response.text());
            if (!response.body) throw new Error("No response body available");

            //Handle the stream
            const parser = createSSEParser();
            const reader = response.body.getReader();

            //Process the stream chunk
            await processStream(reader, async (chunk) => {
                const messages = parser.parse(chunk);
                for (const message of messages) {
                    switch (message.type) {
                        case StreamMessageType.Token:
                            if ("token" in message) {
                                fullResponse += message.token;
                                setStreamedResponse(fullResponse);
                            }
                            break;
                        case StreamMessageType.ToolStart:
                            if ("tool" in message) {
                                setCurrentTool({
                                    name: message.tool as string,
                                    input: message.input,
                                });
                                fullResponse += formatTerminalOutput(message.tool as string, message.input, "Processing...");
                                setStreamedResponse(fullResponse);
                            }
                            break;
                        case StreamMessageType.ToolEnd:
                            if ("tool" in message && currentTool) {
                                const lastTerminalIndex = fullResponse.lastIndexOf(
                                    '<div class="bg-[#1e1e1e]'
                                );
                                if (lastTerminalIndex !== -1) {
                                    fullResponse = fullResponse.substring(0, lastTerminalIndex) + formatTerminalOutput(message.tool as string, currentTool.input, message.output);
                                    setStreamedResponse(fullResponse);
                                }
                                setCurrentTool(null);
                            }
                            break;
                        case StreamMessageType.Error:
                            if ("error" in message) {
                                throw new Error(message.error);
                            }
                            break;
                        case StreamMessageType.Done:
                            //Handle completion of the entire response
                            const assistantMessage: Doc<"messages"> = {
                                _id: `temp_assistant_${Date.now()}`,
                                chatId,
                                content: fullResponse,
                                role: "assistant",
                                createdAt: Date.now(),
                            } as Doc<"messages">;
                            //Save the complete message to the database
                            const convex = getConvexClient();
                            await convex.mutation(api.messages.store, {
                                chatId,
                                content: fullResponse,
                                role: "assistant",
                            });

                            setMessages((prev) => [...prev, assistantMessage]);
                            setStreamedResponse("");
                            return;
                        default:
                            break;
                    }
                }
            });
        } catch (error) {
            console.log("Error sending message:", error);
            setMessages((prev) =>
                prev.filter((msg) => msg._id !== optimisticUserMessage._id)
            );
            setStreamedResponse(
                formatTerminalOutput("Error", "Failed to process message", error instanceof Error ? error.message : "Unknown error")
            );
        } finally {
            setIsLoading(false);
        }
    }
    return (
        <main className="flex flex-col h-[calc(100vh-theme(spacing.14))] ">
            {/* Message */}
            <section className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-0">
                <div className="max-w-4xl mx-auto space-y-3 p-4">

                    {/* Welcome Message */}
                    {messages?.length === 0 && <WelcomeMessage />}
                    {messages?.map((message: Doc<"messages">) => (
                        <MessageBubble key={message._id} content={message.content} isUser={message.role === "user"} />
                    ))}

                    {streamedResponse && <MessageBubble content={streamedResponse} />}

                    {/* Loading indicator */}
                    {isLoading && !streamedResponse && (
                        <div className="flex justify-start animate-in fade-in-0">
                            <div className="rounded-2xl px-4 py-3 bg-white text-gray-900 rounded-bl-none shadow-sm ring-1 ring-inset ring-gray-200">
                                <div className="flex items-center gap-1.5">
                                    {[0.3, 0.15, 0].map((delay, i) => (
                                        <div key={i} className="h-1 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `-${delay}s` }} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

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

export default ChatInterface