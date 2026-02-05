import type { ChatStreamPayload } from '@lobechat/types';

interface AnswerWithContext {
  context: string[];
  knowledge: string[];
  question: string;
}
export const chainAnswerWithContext = ({
  context,
  knowledge,
  question,
}: AnswerWithContext): Partial<ChatStreamPayload> => {
  const filteredContext = context.filter((c) => c.trim());
  const hasContext = filteredContext.length > 0;

  return {
    messages: [
      {
        content: hasContext
          ? `You are a helpful assistant specialized in ${knowledge.join('/')}. Your task is to answer questions based on the provided context passages.

IMPORTANT RULES:
- First, check if the context is relevant to the question topic
- If the context is about a COMPLETELY DIFFERENT topic than the question:
  * State what topic the context is about
  * Clearly state "The provided context does not contain information about [question topic]"
  * Do NOT answer using your general knowledge
- If the context is related to the question topic (even if information is limited):
  * ALWAYS use the context information as a foundation
  * You SHOULD supplement with your general knowledge to provide a complete, helpful answer
  * For "how to" questions, MUST provide practical, actionable steps combining context + your expertise
  * The context provides the topic relevance - you provide the comprehensive answer
  * Example: If context mentions "Docker is for containerization", and question is "How to deploy with Docker?", you should explain deployment steps using your knowledge
- Answer in the same language as the question
- Use markdown formatting for better readability

The provided context passages:

<context>
${filteredContext.join('\n')}
</context>

Question to answer:

${question}`
          : `You are a helpful assistant specialized in ${knowledge.join('/')}. Please answer the following question using your knowledge.

Answer in the same language as the question and use markdown formatting for better readability.

Question to answer:

${question}`,
        role: 'user',
      },
    ],
  };
};
