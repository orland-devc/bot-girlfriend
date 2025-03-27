const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class MemoryManager {
    constructor(client, options = {}) {
        this.client = client;
        
        // Memory storage paths
        this.memoryDir = path.join(__dirname, 'memories');
        this.userMemoryDir = path.join(this.memoryDir, 'users');
        
        // API configuration from existing setup
        this.apiKey = process.env.API_KEY;
        this.apiModel = process.env.API_MODEL;
        this.axiosPost = process.env.AXIOS_POST;
        
        // Default configuration
        this.config = {
            maxMemoriesPerUser: options.maxMemoriesPerUser || 100,
            memoryRetentionDays: options.memoryRetentionDays || 365,
            similarityThreshold: options.similarityThreshold || 0.7
        };
        
        // Ensure memory directories exist
        this.initializeDirectories();
    }
    
    initializeDirectories() {
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir);
        }
        if (!fs.existsSync(this.userMemoryDir)) {
            fs.mkdirSync(this.userMemoryDir);
        }
    }
    
    // Generate embedding using Together AI API
    async generateEmbedding(text) {
        try {
            const response = await axios.post(
                this.axiosPost,
                {
                    model: this.apiModel,
                    messages: [
                        { 
                            role: "system", 
                            content: "Generate a semantic embedding for the following text:" 
                        },
                        { 
                            role: "user", 
                            content: text 
                        }
                    ],
                    max_tokens: 50  // Limit token generation
                },
                { 
                    headers: { 
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    } 
                }
            );
            
            // Extract embedding from response (this might need adjustment based on API specifics)
            const embedding = response.data.choices[0].message.content;
            return this.processEmbedding(embedding);
        } catch (error) {
            console.error("Embedding Generation Error:", error);
            return null;
        }
    }
    
    // Process and normalize embedding
    processEmbedding(embeddingText) {
        // Convert text embedding to numerical array
        try {
            // This is a simple conversion. You might need to adjust based on your API's exact response
            return embeddingText
                .split(',')
                .map(val => parseFloat(val.trim()))
                .filter(val => !isNaN(val));
        } catch (error) {
            console.error("Embedding Processing Error:", error);
            return null;
        }
    }
    
    // Calculate cosine similarity between embeddings
    cosineSimilarity(embedding1, embedding2) {
        if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
            return 0;
        }
        
        // Dot product
        const dotProduct = embedding1.reduce((sum, a, i) => sum + a * embedding2[i], 0);
        
        // Magnitudes
        const magnitude1 = Math.sqrt(embedding1.reduce((sum, a) => sum + a * a, 0));
        const magnitude2 = Math.sqrt(embedding2.reduce((sum, a) => sum + a * a, 0));
        
        // Cosine similarity
        return dotProduct / (magnitude1 * magnitude2);
    }
    
    // Create a new memory for a user
    async createMemory(userId, content, metadata = {}) {
        const userMemoryPath = path.join(this.userMemoryDir, `${userId}.json`);
        
        // Generate embedding
        const embedding = await this.generateEmbedding(content);
        
        // Load existing memories or initialize
        const memories = this.loadUserMemories(userId);
        
        // Create unique memory entry
        const memoryEntry = {
            id: uuidv4(),
            content,
            embedding,
            timestamp: new Date().toISOString(),
            metadata: {
                ...metadata,
                createdAt: new Date().toISOString()
            }
        };
        
        // Add memory and trim if over max
        memories.push(memoryEntry);
        if (memories.length > this.config.maxMemoriesPerUser) {
            memories.shift(); // Remove oldest memory
        }
        
        // Save memories
        fs.writeFileSync(userMemoryPath, JSON.stringify(memories, null, 2));
        
        return memoryEntry;
    }
    
    // Load memories for a specific user
    loadUserMemories(userId) {
        const userMemoryPath = path.join(this.userMemoryDir, `${userId}.json`);
        
        try {
            if (fs.existsSync(userMemoryPath)) {
                const memoryData = fs.readFileSync(userMemoryPath, 'utf8');
                return JSON.parse(memoryData);
            }
            return [];
        } catch (error) {
            console.error(`Error loading memories for user ${userId}:`, error);
            return [];
        }
    }
    
    // Find similar memories
    async findSimilarMemories(userId, query, options = {}) {
        const limit = options.limit || 5;
        const similarityThreshold = options.similarityThreshold || this.config.similarityThreshold;
        
        // Generate embedding for query
        const queryEmbedding = await this.generateEmbedding(query);
        if (!queryEmbedding) return [];
        
        // Load user memories
        const memories = this.loadUserMemories(userId);
        
        // Calculate similarities and filter
        const similarMemories = memories
            .map(memory => ({
                ...memory,
                similarity: this.cosineSimilarity(queryEmbedding, memory.embedding || [])
            }))
            .filter(memory => memory.similarity >= similarityThreshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        
        return similarMemories;
    }
    
    // Remove old memories
    pruneOldMemories() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.memoryRetentionDays);
        
        const userFiles = fs.readdirSync(this.userMemoryDir);
        
        userFiles.forEach(file => {
            const userId = path.basename(file, '.json');
            const userMemoryPath = path.join(this.userMemoryDir, file);
            
            let memories = this.loadUserMemories(userId);
            
            // Filter out memories older than cutoff
            memories = memories.filter(memory => 
                new Date(memory.metadata.createdAt) >= cutoffDate
            );
            
            // Save pruned memories
            fs.writeFileSync(userMemoryPath, JSON.stringify(memories, null, 2));
        });
    }
    
    // Integrate with response system
    setupMemoryIntegration(responseSystem) {
        // Modify generateResponse to use memory
        const originalGenerateResponse = responseSystem.generateResponse;
        
        responseSystem.generateResponse = async (userMessage, username, userId) => {
            // Retrieve similar past memories
            const similarMemories = await this.findSimilarMemories(userId, userMessage);
            
            // Prepare context with memories
            const memoryContext = similarMemories.map(memory => ({
                role: "system",
                content: `Relevant past memory (Similarity: ${memory.similarity.toFixed(2)}): ${memory.content}`
            }));
            
            // Create memory of this interaction
            await this.createMemory(userId, userMessage, { 
                username, 
                type: 'user_message' 
            });
            
            // Get personality context (assuming this function exists in your original code)
            const personalityContext = getPersonalityContext(username, userId);
            
            // Combine memory context with original personality context
            const context = [
                ...personalityContext,
                ...memoryContext,
                { role: "user", content: userMessage }
            ];
            
            // Use original response generation with enhanced context
            const response = await originalGenerateResponse(context);
            
            // Create memory of bot response
            await this.createMemory(userId, response, { 
                username, 
                type: 'bot_response' 
            });
            
            return response;
        };
        
        // Set up periodic memory pruning
        setInterval(() => this.pruneOldMemories(), 24 * 60 * 60 * 1000); // Daily
    }
}

module.exports = MemoryManager;