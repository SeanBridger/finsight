export const CONFIG = {
  account: '284394464353',
  region: 'us-east-1',
  projectName: 'finsight',

  // Bedrock model identifiers
  // Newer models require inference profile IDs (us. prefix)
  // Titan Embeddings still uses direct model ID
  models: {
    chat: 'us.anthropic.claude-sonnet-4-6',
    chatCheap: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    embeddings: 'amazon.titan-embed-text-v2:0',
  },

  // Embedding dimensions — Titan v2 supports 256, 512, 1024
  // 1024 = best accuracy, 512 = 99% accuracy at half the storage
  embeddingDimensions: 1024,
};