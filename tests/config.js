const aiModel = 'qwen3:14b';

export const aiPrompt = (messages) => ({
	model: aiModel,
	messages,
	stream: false,
	think: false, // Disable reasoning (requires a recent Ollama version)
	options: {
		temperature: 0,
		top_k: 1,
		top_p: 1,
		repeat_penalty: 1,
		num_predict: 1,
		seed: 42,
	},
});
