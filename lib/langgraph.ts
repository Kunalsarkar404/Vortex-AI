import { ChatAnthropic } from "@langchain/anthropic";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import wxflows from "@wxflows/sdk/langchain";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import SYSTEM_MESSAGE from "@/constants/systemMessage";
import { AIMessage, SystemMessage, trimMessages } from "@langchain/core/messages";

//Trim the mesage to manage conversation history
const trimmer = trimMessages({
    maxTokens: 10,
    strategy: "last",
    tokenCounter: (message) => message.length,
    includeSystem: true,
    allowPartial: false,
    startOn: "human",
})

//Connect to wxflows
const toolClient = new wxflows({
    endpoint: process.env.WXFLows_ENDPOINT || "",
    apikey: process.env.WXFLows_API_KEY
})

//Retrive the tools
const tools = await toolClient.lcTools;
const toolNode = new ToolNode(tools);

export const initialiseModal = () => {

    const model = new ChatAnthropic({
        model: "claude-3-5-sonnet-20241022",
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        temperature: 0.7, //Higher temperature for more creative responses
        maxTokens: 1024, //Higher maxTokens for longer responses
        streaming: true, //Enable streaming for real-time updates
        clientOptions: {
            defaultHeaders: {
                "anthropic-beta": "prompt-caching-2024-07-31",
            },
        },
        callbacks: [
            {
                handleLLMStart: async () => {
                    console.log("LLM started");
                },
                handleLLMEnd: async (output) => {
                    console.log("LLM ended", output);
                    const usage = output.llmOutput?.usage;
                    if (usage) {
                        // console.log("Token Usage:", {
                        //     input_tokens: usage.input_tokens,
                        //     output_tokens: usage.output_tokens,
                        //     total_tokens: usage.input_tokens + usage.output_tokens,
                        //     cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                        //     cache_read_input_tokens: usage.cache_read_input_tokens || 0,
                        // });
                    }
                },
                // handleLLMNewToken: async (token: string) => {
                //     console.log("New token:", token);
                // },
            }
        ]
    }).bindTools(tools);

    return model;
}

//Define the function that determines whether the function should continue or end
const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const lastMessage = messages.at(-1) as AIMessage;
    if(lastMessage.tool_calls?.length) {
        return "tools";
    }
    if(lastMessage.content && lastMessage._getType() === "tool") {
        return "agent";
    }
    return END;
}

const createWorkflow = () => {
    const model = initialiseModal();
    const stateGraph = new StateGraph(MessagesAnnotation).addNode(
        "agent",
        async (state) => {
            const systemContent = SYSTEM_MESSAGE;

            //Create the prompt template with system message and messages placeholder
            const promptTemplate = ChatPromptTemplate.fromMessages([
                new SystemMessage(systemContent, {
                    cache_control: { type: "ephemeral" }, //Set a cache breakpoint (max number of breakpoint is 4)
                }),
                new MessagesPlaceholder("messages"),
            ]);

            const trimmedMessages = await trimmer.invoke(state.messages);

            const prompt = await promptTemplate.invoke({ messages: trimmedMessages });

            const response = await model.invoke(prompt);

            return { messages: [response] };
        }
    ).addEdge(START, "agent").addNode("tools", toolNode).addConditionalEdges("agent", shouldContinue).addEdge("tools", "agent");
    return stateGraph;
}
