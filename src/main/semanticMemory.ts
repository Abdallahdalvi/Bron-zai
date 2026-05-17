/**
 * SemanticMemory — Vector-based memory with embeddings for intelligent retrieval
 * Replaces keyword-only search with semantic similarity
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getSettings } from './memory';

export interface MemoryEmbedding {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    source: 'core' | 'soul' | 'daily' | 'conversation';
    timestamp: string;
    taskId?: number;
    sessionId?: number;
    importance?: number; // 0-1, higher = more important
  };
}

export interface SemanticSearchResult {
  memory: MemoryEmbedding;
  similarity: number;
}

interface EmbeddingProvider {
  name: string;
  dimension: number;
  initialize?(): Promise<void>;
  generateEmbedding(text: string): Promise<number[]>;
}

/** Simple local embedding using TensorFlow.js (no API calls, fully private) */
class LocalEmbeddingProvider implements EmbeddingProvider {
  name = 'local-tensorflow';
  dimension = 384; // all-MiniLM-L6-v2 dimension
  private model: any = null;
  private pipeline: any = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Dynamic import to avoid loading TensorFlow unless needed
      // @ts-ignore - Optional dependency
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.initialized = true;
    } catch (error) {
      console.error('Failed to load embedding model:', error);
      throw new Error('Could not initialize local embeddings. Try using API-based embeddings.');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not available');
    }

    const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }
}

/** OpenAI API-based embedding (higher quality, requires API key) */
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai-api';
  dimension = 1536;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000), // OpenAI limit
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status}`);
    }

    const data: any = await response.json();
    return data.data[0].embedding;
  }
}

/** OpenRouter API-based embedding (uses same key as chat) */
class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  name = 'openrouter-api';
  dimension = 1024;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Bron Semantic Memory',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter embedding failed: ${response.status}`);
    }

    const data: any = await response.json();
    return data.data[0].embedding;
  }
}

class SemanticMemorySystem {
  private embeddings: Map<string, MemoryEmbedding> = new Map();
  private provider: EmbeddingProvider | null = null;
  private indexPath: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const bronHome = path.join(app.getPath('home'), '.bron');
    const vectorDir = path.join(bronHome, 'vectors');
    await fs.mkdir(vectorDir, { recursive: true });
    this.indexPath = path.join(vectorDir, 'memory-embeddings.json');

    await this.createEmbeddingProvider();
    await this.loadEmbeddings();

    this.initialized = true;
  }

  private async createEmbeddingProvider(): Promise<void> {
    const settings = getSettings();
    const embeddingProvider = settings.embeddingProvider || 'local';
    const openRouterKey = settings.apiKey;

    if (embeddingProvider === 'openai' && settings.openaiApiKey) {
      this.provider = new OpenAIEmbeddingProvider(settings.openaiApiKey);
    } else if (embeddingProvider === 'openrouter' && openRouterKey) {
      this.provider = new OpenRouterEmbeddingProvider(openRouterKey);
    } else {
      // Default to local
      try {
        this.provider = new LocalEmbeddingProvider();
        if (this.provider.initialize) {
          await this.provider.initialize();
        }
      } catch {
        console.warn('Local embeddings unavailable, falling back to keyword search');
        this.provider = null;
      }
    }
  }

  private async loadEmbeddings(): Promise<void> {
    if (!this.indexPath) return;

    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [id, embedding] of Object.entries(parsed)) {
        this.embeddings.set(id, embedding as MemoryEmbedding);
      }
    } catch {
      // File doesn't exist or is corrupted — start fresh
      this.embeddings.clear();
    }
  }

  private async saveEmbeddings(): Promise<void> {
    if (!this.indexPath) return;

    const data: Record<string, MemoryEmbedding> = {};
    for (const [id, embedding] of this.embeddings) {
      data[id] = embedding;
    }

    await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /** Add a memory with automatic embedding generation */
  async addMemory(
    content: string,
    metadata: MemoryEmbedding['metadata']
  ): Promise<MemoryEmbedding | null> {
    if (!this.provider) return null;

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    try {
      const embedding = await this.provider.generateEmbedding(content);
      const memory: MemoryEmbedding = {
        id,
        content,
        embedding,
        metadata: {
          ...metadata,
          timestamp: metadata.timestamp || new Date().toISOString(),
        },
      };

      this.embeddings.set(id, memory);
      await this.saveEmbeddings();

      // Prune old embeddings if over limit
      await this.pruneEmbeddings(1000);

      return memory;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return null;
    }
  }

  /** Search memories by semantic similarity */
  async search(
    query: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      sourceFilter?: Array<MemoryEmbedding['metadata']['source']>;
    } = {}
  ): Promise<SemanticSearchResult[]> {
    if (!this.provider) return [];

    const { limit = 5, minSimilarity = 0.7, sourceFilter } = options;

    try {
      const queryEmbedding = await this.provider.generateEmbedding(query);

      const results: SemanticSearchResult[] = [];

      for (const memory of this.embeddings.values()) {
        // Apply source filter
        if (sourceFilter && !sourceFilter.includes(memory.metadata.source)) {
          continue;
        }

        const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);
        
        if (similarity >= minSimilarity) {
          results.push({ memory, similarity });
        }
      }

      // Sort by similarity (descending)
      results.sort((a, b) => b.similarity - a.similarity);

      return results.slice(0, limit);
    } catch (error) {
      console.error('Semantic search failed:', error);
      return [];
    }
  }

  /** Hybrid search: combines keyword and semantic */
  async hybridSearch(
    query: string,
    options: {
      limit?: number;
      keywordWeight?: number; // 0-1, default 0.3
    } = {}
  ): Promise<SemanticSearchResult[]> {
    const { limit = 5, keywordWeight = 0.3 } = options;

    // Get semantic results
    const semanticResults = await this.search(query, { limit: limit * 2 });

    // Calculate keyword scores for additional boosting
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    const boosted = semanticResults.map(result => {
      const contentLower = result.memory.content.toLowerCase();
      let keywordMatches = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) keywordMatches++;
      }
      const keywordScore = queryWords.length > 0 ? keywordMatches / queryWords.length : 0;

      // Blend semantic and keyword scores
      const blendedScore = (result.similarity * (1 - keywordWeight)) + (keywordScore * keywordWeight);

      return {
        memory: result.memory,
        similarity: blendedScore,
      };
    });

    boosted.sort((a, b) => b.similarity - a.similarity);
    return boosted.slice(0, limit);
  }

  /** Delete a memory by ID */
  async deleteMemory(id: string): Promise<boolean> {
    const deleted = this.embeddings.delete(id);
    if (deleted) {
      await this.saveEmbeddings();
    }
    return deleted;
  }

  /** Clear all embeddings */
  async clearAll(): Promise<void> {
    this.embeddings.clear();
    await this.saveEmbeddings();
  }

  /** Get memory count */
  getCount(): number {
    return this.embeddings.size;
  }

  /** Prune oldest embeddings to stay under limit */
  private async pruneEmbeddings(maxCount: number): Promise<void> {
    if (this.embeddings.size <= maxCount) return;

    // Sort by importance and recency
    const sorted = Array.from(this.embeddings.values()).sort((a, b) => {
      const importanceDiff = (b.metadata.importance || 0.5) - (a.metadata.importance || 0.5);
      if (importanceDiff !== 0) return importanceDiff;
      return new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime();
    });

    // Keep top maxCount
    const toKeep = new Set(sorted.slice(0, maxCount).map(m => m.id));
    
    for (const id of this.embeddings.keys()) {
      if (!toKeep.has(id)) {
        this.embeddings.delete(id);
      }
    }

    await this.saveEmbeddings();
  }

  /** Calculate cosine similarity between two vectors */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** Get embedding stats */
  getStats(): {
    count: number;
    provider: string;
    dimension: number;
  } {
    return {
      count: this.embeddings.size,
      provider: this.provider?.name || 'none',
      dimension: this.provider?.dimension || 0,
    };
  }
}

// Singleton instance
export const semanticMemory = new SemanticMemorySystem();

/** Legacy compatibility: Initialize on app start */
export async function initSemanticMemory(): Promise<void> {
  await semanticMemory.initialize();
}

/** Utility: Index all existing markdown memories */
export async function indexExistingMemories(): Promise<number> {
  const { readCore, readSoul, getMemoryPaths } = await import('../memory');
  
  let indexed = 0;

  try {
    // Index CORE.md
    const coreContent = await readCore();
    const coreSections = coreContent.split(/\n## /).filter(s => s.trim());
    for (const section of coreSections) {
      const lines = section.split('\n');
      const title = lines[0].replace(/^#+\s*/, '');
      const content = lines.slice(1).join('\n').trim();
      if (content) {
        await semanticMemory.addMemory(content, {
          source: 'core',
          timestamp: new Date().toISOString(),
        });
        indexed++;
      }
    }

    // Index SOUL.md
    const soulContent = await readSoul();
    // Similar sectioning...

    // Index daily files
    const { memoryDir } = getMemoryPaths();
    const files = await fs.readdir(memoryDir).catch(() => []);
    const dailyFiles = files.filter((f: string) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    
    for (const file of dailyFiles) {
      const content = await fs.readFile(path.join(memoryDir, file), 'utf-8').catch(() => '');
      if (content) {
        // Split by entry
        const entries = content.split(/\n## \d{2}:\d{2}/).filter(s => s.trim());
        for (const entry of entries) {
          if (entry.length > 50) { // Min length to avoid index noise
            await semanticMemory.addMemory(entry, {
              source: 'daily',
              timestamp: new Date().toISOString(),
            });
            indexed++;
          }
        }
      }
    }
  } catch (error) {
    console.error('Indexing existing memories failed:', error);
  }

  return indexed;
}

