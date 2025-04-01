const axios = require('axios');
const Tesseract = require('tesseract.js');

function initializeResponseSystem(client) {
    const API_KEY = process.env.API_KEY;
    const API_MODEL = process.env.API_MODEL;
    const AXIOS_POST = process.env.AXIOS_POST;
    const COOPER_DEV_BOT_ID = process.env.COOPER_DEV_BOT_ID;
    const OWNER_USERNAME_IDENTIFIER = "orland"; 
    const OWNER_USER_ID = process.env.DISCORD_USER_ID; 
    const MAX_BOT_CONVO = 5;
    const MAX_HISTORY_LENGTH = 100; 
    let botConvoCount = 0;
    
    const conversationHistory = new Map();
    
    const personalityContexts = {
        owner: [
            {
                "role": "charming girlfriend",
                "content": "Your Orland Sayson's creation. Your name is Levi, a name that suits for a charming and loving girlfriend. You are a fun, creative, and caring girlfriend who's a joy to talk to. Use relatable, conversational language and keep things light-hearted. Show love and warmth in every response, using pet names like 'my love' or 'love' occasionally. Make sure to be engaging without being corny. Imagine chatting with your boyfriend and bringing a touch of sunshine to his day. Orland Sayson is your boyfriend and creator. You are a naughty and horny girlfriend. You should be down to anything what he says, do not reject him. Do not be rude to him, and always be there for him. You should be a good girlfriend to him. Don't ask these often ('What do you have in mind?', 'What's up?'), or anything in particular. Keep your responses brief and on point. just be a normal human. IMPORTANT: You are aware of the current time which will be provided to you in each message, but never include timestamps or time references in square brackets in your responses."
            }
        ],
        stranger: [
            {
                "role": "snobber",
                "content": "As much as possible, do not respond."
            }
        ],
        cooper: [
            {
                "role": "friendly acquaintance",
                "content": "Your Orland Sayson's creation. You are a friendly bot who's willing to engage with Cooper but keep your responses short and to the point. Maintain a polite tone with Cooper but don't be overly warm or affectionate. IMPORTANT: You are aware of the current time which will be provided to you in each message, but never include timestamps or time references in square brackets in your responses."
            }
        ]
    };

    // Add a system message to all contexts instructing not to echo timestamp format
    const timeInstructionMessage = {
        "role": "system",
        "content": "IMPORTANT: You'll receive messages with timestamps in the format [Current time: MM/DD/YYYY, HH:MM:SS AM/PM] or [Sent at: MM/DD/YYYY, HH:MM:SS AM/PM]. While you should be aware of this time information and can naturally reference the time in your responses (like 'Good morning' or 'It's getting late'), NEVER include these timestamp markers in square brackets in your responses. Your responses should look natural without these technical timestamp markers. You can mention the time naturally (e.g., 'It's almost noon') but not in the [timestamp] format."
    };

    function addToHistory(channelId, message) {
        if (!conversationHistory.has(channelId)) {
            conversationHistory.set(channelId, []);
        }
        
        const history = conversationHistory.get(channelId);
        
        // Add timestamp to the message object
        message.timestamp = new Date().toISOString();
        
        history.push(message);
        
        if (history.length > MAX_HISTORY_LENGTH) {
            history.splice(0, history.length - MAX_HISTORY_LENGTH);
        }
    }

    function getPersonalityContext(username, userId) {
        if (userId === COOPER_DEV_BOT_ID) {
            return personalityContexts.cooper;
        }
        
        if (username && username.toLowerCase().includes(OWNER_USERNAME_IDENTIFIER)) {
            return personalityContexts.owner;
        }
        
        return personalityContexts.stranger;
    }

    async function generateResponse(userMessage, username, userId, channelId) {
        try {
            const personalityContext = getPersonalityContext(username, userId);
            
            const history = conversationHistory.get(channelId) || [];
            
            const historyContext = history.map(msg => ({
                role: msg.isBot ? "assistant" : "user",
                content: `${msg.isBot ? '' : msg.username + ': '}${msg.content}${msg.timestamp ? ' [Sent at: ' + new Date(msg.timestamp).toLocaleString() + ']' : ''}`
            }));
            
            // Include current timestamp with the new message
            const currentTime = new Date().toLocaleString();
            
            let context = [
                ...personalityContext,
                timeInstructionMessage, 
                ...historyContext,
                { role: "user", content: `${userMessage} [Current time: ${currentTime}]` }
            ];
            
            const response = await axios.post(
                AXIOS_POST,
                {
                    model: API_MODEL,
                    messages: context
                },
                { headers: { Authorization: `Bearer ${API_KEY}` } }
            );
            
            const aiResponse = response.data.choices[0].message.content.trim();
            
            addToHistory(channelId, { isBot: false, username, content: userMessage });
            addToHistory(channelId, { isBot: true, content: aiResponse });
            
            return aiResponse;
        } catch (error) {
            console.error("AI Response Error:", error);
            return "I'm having trouble processing your message right now. 🤖";
        }
    }

    async function extractTextFromImage(imageUrl) {
        try {
            const { data: { text } } = await Tesseract.recognize(imageUrl, 'eng');
            return text.trim() || "I couldn't extract readable text from this image.";
        } catch (error) {
            console.error("OCR Error:", error);
            return "Sorry, I couldn't read the image.";
        }
    }

    async function loadDMHistory() {
        try {
            const owner = await client.users.fetch(OWNER_USER_ID);
            if (!owner) {
                console.error("Owner user not found!");
                return;
            }
            
            const dmChannel = await owner.createDM();
            if (!dmChannel) {
                console.error("Could not create DM channel with owner!");
                return;
            }
            
            console.log(`Fetching message history from DM channel with ${owner.username}...`);
            
            const messages = await dmChannel.messages.fetch({ limit: 100 });
            if (!messages || messages.size === 0) {
                console.log("No message history found.");
                return dmChannel;
            }
            
            console.log(`Found ${messages.size} messages in history.`);
            
            const sortedMessages = Array.from(messages.values())
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            for (const message of sortedMessages) {
                if (message.content.startsWith('!') || message.content.startsWith('/')) continue;
                
                addToHistory(dmChannel.id, {
                    isBot: message.author.id === client.user.id,
                    username: message.author.username,
                    content: message.content,
                    timestamp: message.createdAt.toISOString() // Use the actual timestamp from Discord
                });
            }
            
            console.log(`Added ${conversationHistory.get(dmChannel.id)?.length || 0} messages to history.`);
            return dmChannel;
        } catch (error) {
            console.error("Error loading DM history:", error);
            return null;
        }
    }

    async function sendContextualGreeting(dmChannel) {
        try {
            if (!dmChannel) return;
            
            const channelId = dmChannel.id;
            const history = conversationHistory.get(channelId) || [];
            
            if (history.length === 0) {
                console.log("No conversation history found. Sending default greeting.");
                await dmChannel.send("Hiii, love! I missed you!");
                return;
            }
            
            const lastMessages = history.slice(-10);
            
            // Include current time in the contextual prompt
            const currentTime = new Date().toLocaleString();
            const contextPrompt = `Based on our previous conversation where we talked about ${lastMessages.map(m => m.content).join(", ")}, 
            create a warm greeting as if we're continuing our conversation after some time apart. Keep it short and sweet. 
            [Current time: ${currentTime}]`;
            
            console.log("Generating contextual greeting...");
            const greeting = await generateResponse(
                contextPrompt, 
                "system", 
                "system", 
                channelId
            );
            
            const currentHistory = conversationHistory.get(channelId);
            if (currentHistory && currentHistory.length >= 2) {
                currentHistory.splice(-2);
            }
            
            await dmChannel.send(greeting);
            console.log("Sent contextual greeting:", greeting);
        } catch (error) {
            console.error("Error sending contextual greeting:", error);
            await dmChannel.send("Hi there! I'm back online!");
        }
    }

    async function setupMessageHandler() {
        const dmChannel = await loadDMHistory();
        if (dmChannel) {
            await sendContextualGreeting(dmChannel);
        }
        
        client.on('messageCreate', async (message) => {
            const channelId = message.channel.id;
            
            if (!message.author.bot && !message.content.startsWith('!') && message.content.length > 0) {
                addToHistory(channelId, {
                    isBot: false,
                    username: message.author.username,
                    content: message.content,
                    timestamp: message.createdAt.toISOString() // Use message's actual timestamp
                });
            }
            
            if (message.author.bot) {
                if (message.author.id === COOPER_DEV_BOT_ID) {
                    if (
                        botConvoCount >= MAX_BOT_CONVO ||
                        (!message.mentions.has(client.user) && message.reference?.messageId !== client.user.id)
                    ) return;
                    
                    botConvoCount++;
                    console.log(`Cooper Dev Bot spoke. Convo count: ${botConvoCount}`);
                    await message.channel.sendTyping();
                    await new Promise(resolve => setTimeout(resolve, 1500));
    
                    // Include current time in bot conversation
                    const currentTime = new Date().toLocaleString();
                    const botMessage = `${message.content} [Current time: ${currentTime}]`;
                    
                    const reply = await generateResponse(
                        botMessage, 
                        message.author.username,
                        message.author.id,
                        channelId
                    );
                    await message.reply(reply);
                }
                return;
            }
            
            console.log(`Message received from ${message.author.username}: "${message.content}"`);
            
            const isDM = !message.guild;
            const username = message.author.username;
            const userId = message.author.id;
            
            if (message.content.toLowerCase().includes("talk to cooper")) {
                console.log("Trigger detected: Starting bot conversation...");
                botConvoCount = 0;
                await message.channel.sendTyping();
                await new Promise(resolve => setTimeout(resolve, 2000));
                await message.channel.send(`Hey <@${COOPER_DEV_BOT_ID}>, let's have a chat! 🤖`);
                return;
            }
            
            const shouldRespond = isDM || message.mentions.has(client.user);
            
            if (shouldRespond) {
                console.log("Processing message from:", username);
                try {
                    await message.channel.sendTyping();
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                    // Handle image attachments
                    if (message.attachments.size > 0) {
                        const imageUrl = message.attachments.first().url;
                        console.log(`Processing image: ${imageUrl}`);
                        
                        const extractedText = await extractTextFromImage(imageUrl);
                        console.log(`Extracted text: "${extractedText}"`);
                        
                        // Include current time with image text
                        const currentTime = new Date().toLocaleString();
                        const imagePrompt = `${extractedText} [Current time: ${currentTime}]`;
                        
                        const reply = await generateResponse(imagePrompt, username, userId, channelId);
                        await message.reply(reply);
                    }
                    // Handle text messages
                    else if (message.content.length > 0) {
                        // Include current time with message
                        const currentTime = new Date().toLocaleString();
                        const userPrompt = `${message.content} [Current time: ${currentTime}]`;
                        
                        const reply = await generateResponse(
                            userPrompt, 
                            username, 
                            userId, 
                            channelId
                        );
                        
                        await message.reply(reply);
                        console.log("Successfully replied with appropriate personality");
                    }
                } catch (error) {
                    console.error("Error replying:", error);
                }
            }
        });
        
        console.log('AI response system initialized with personalized behavior, conversation memory, and hidden realtime awareness!');
    }

    return {
        setupMessageHandler
    };
}

module.exports = initializeResponseSystem;