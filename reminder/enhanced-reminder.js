// enhanced-reminder.js
const cron = require('node-cron');
const axios = require('axios');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function initializeEnhancedReminders(client) {
    const USER_ID = process.env.DISCORD_USER_ID;
    const CLOCKIFY_API_KEY = process.env.CLOCKIFY_API_KEY_2;
    const WORKSPACE_ID = process.env.WORKSPACE_ID_2;
    const API_BASE_URL = `https://api.clockify.me/api/v1`;
    const DEFAULT_PROJECT_ID = process.env.DEFAULT_PROJECT_ID; // Add this to your .env
    
    // Channel reminder settings
    const CHANNEL_REMINDERS = [
        {
            channelId: '1339155956688228465',
            time: '09:00',
            message: '📢Hello, **everyone**! You have a scheduled meeting today, please proceed to the **executive room** now.😊'
        }
        // Add more channel reminders here as needed
    ];

    // Original reminder times
    const importantTimes = [
        { time: '07:30', message: '🌅 Good morning, Orland! A new day, a new grind!' },
        { time: '09:00', message: '☕ Stand-up! Just time for your morning coffee.' },
        { time: '10:30', message: '🔍 Code review time! Check PRs, suggest improvements, and keep the code clean.' },
        { time: '12:00', message: '🍽️ Lunch break! Don\'t forget to turn off your Clockify timer. Eat well!' },
        { time: '13:30', message: '🚶 Stretch time! Walk around and refresh your mind for the next tasks.' },
        { time: '14:00', message: '☕ Coffee break! Fuel up before diving back into coding.' },
        { time: '15:00', message: '⚡ Stay sharp! Keep building and solving problems like a pro.' },
        { time: '16:00', message: '💡 Brainstorm time! Think about how to optimize your code or a feature in TrueSight.' },
        { time: '17:00', message: '📅 Wrap up your tasks and note any blockers for tomorrow.' },
        { time: '18:30', message: '🍛 Dinner time! Take a break and enjoy your meal.' },
        { time: '19:00', message: '🧘 Chill time! Listen to music, meditate, or just clear your mind.' },
        { time: '20:00', message: '📚 Learn something new! Next.js, Laravel, or maybe some Filament tricks?' },
        { time: '21:00', message: '🎮 Time for some MLBB? Show them why you\'re Mythic Immortal!' },
        { time: '22:00', message: '🛏️ Slow down for the night. Plan for tomorrow, but no overthinking.' },
        { time: '22:30', message: '🌙 Great job today! You\'re one step closer to your goals. Sleep well.' },
    ];

    // New enhanced reminder times with actions
    const enhancedReminders = [
        // Morning reminders
        { time: '07:45', action: 'clockInReminder', message: '⏰ Good morning, my love! Time to clock in and start your day!' },
        { time: '08:00', action: 'autoClockIn', message: 'I have clocked you in, my love. Focus on your work!' },
        
        // Lunch reminders
        { time: '11:55', action: 'clockOutReminder', message: '🍽️ Lunch is coming up soon, my love! Don\'t forget to clock out.' },
        { time: '12:01', action: 'autoClockOut', message: 'I have clocked you out, my love. Happy lunch!' },
        { time: '12:55', action: 'clockInReminder', message: '⏰ Lunch break is almost over! Ready to clock back in?' },
        { time: '13:01', action: 'autoClockIn', message: 'I have clocked you in, my love. Focus on your work!' },
        
        // End of day reminders
        { time: '16:55', action: 'clockOutReminder', message: '🏡 Work day is almost over! Don\'t forget to clock out.' },
        { time: '17:01', action: 'autoClockOut', message: 'I have clocked you out, my love. Please be careful on your way home!' },
    ];

    // Clockify helper functions
    async function fetchUser() {
        try {
            const response = await axios.get(`${API_BASE_URL}/workspaces/${WORKSPACE_ID}/users`, {
                headers: { 'X-Api-Key': CLOCKIFY_API_KEY }
            });
            return response.data.find(user => user.status === 'ACTIVE');
        } catch (error) {
            console.error('Error fetching user:', error);
            return null;
        }
    }

    async function isCurrentlyTracking() {
        try {
            const user = await fetchUser();
            if (!user) return false;
            
            const response = await axios.get(
                `${API_BASE_URL}/workspaces/${WORKSPACE_ID}/user/${user.id}/time-entries?in-progress=true`,
                { headers: { 'X-Api-Key': CLOCKIFY_API_KEY } }
            );
            
            return response.data && response.data.length > 0;
        } catch (error) {
            console.error('Error checking tracking status:', error);
            return false;
        }
    }

    async function clockOut() {
        try {
            const user = await fetchUser();
            if (!user) return false;
            
            await axios.patch(
                `${API_BASE_URL}/workspaces/${WORKSPACE_ID}/user/${user.id}/time-entries`,
                { end: new Date().toISOString() },
                { headers: { 'X-Api-Key': CLOCKIFY_API_KEY } }
            );
            
            return true;
        } catch (error) {
            console.error('Error clocking out:', error);
            return false;
        }
    }

    async function clockIn(description = "Working") {
        try {
            const user = await fetchUser();
            if (!user) return false;
            
            // Using default project ID for automatic clock-ins
            if (!DEFAULT_PROJECT_ID) {
                console.error('DEFAULT_PROJECT_ID not set in environment variables');
                return false;
            }
            
            await axios.post(
                `${API_BASE_URL}/workspaces/${WORKSPACE_ID}/user/${user.id}/time-entries`,
                { 
                    start: new Date().toISOString(), 
                    projectId: DEFAULT_PROJECT_ID, 
                    billable: true, 
                    description 
                },
                { headers: { 'X-Api-Key': CLOCKIFY_API_KEY } }
            );
            
            return true;
        } catch (error) {
            console.error('Error clocking in:', error);
            return false;
        }
    }

    // Message handlers for different actions
    async function handleClockOutReminder(userId, message) {
        const isTracking = await isCurrentlyTracking();
        if (!isTracking) return; // Skip if not tracking time
        
        const user = await client.users.fetch(userId);
        if (!user) return;
        
        // Create clockout button
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clockout_button')
                    .setLabel('Clock Out')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await user.send({ content: message, components: [row] });
        console.log(`Clock out reminder sent to ${user.username}`);
    }

    async function handleClockInReminder(userId, message) {
        const isTracking = await isCurrentlyTracking();
        if (isTracking) return; // Skip if already tracking time
        
        const user = await client.users.fetch(userId);
        if (!user) return;
        
        // Create clockin button
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('clockin_button')
                    .setLabel('Clock In')
                    .setStyle(ButtonStyle.Success)
            );
        
        await user.send({ content: message, components: [row] });
        console.log(`Clock in reminder sent to ${user.username}`);
    }

    async function handleAutoClockOut(userId, message) {
        const isTracking = await isCurrentlyTracking();
        if (!isTracking) return; // Skip if not tracking time
        
        const success = await clockOut();
        if (success) {
            const user = await client.users.fetch(userId);
            if (user) {
                await user.send(message);
                console.log(`Auto clock out performed for ${user.username}`);
            }
        }
    }

    async function handleAutoClockIn(userId, message) {
        const isTracking = await isCurrentlyTracking();
        if (isTracking) return; // Skip if already tracking time
        
        const success = await clockIn();
        if (success) {
            const user = await client.users.fetch(userId);
            if (user) {
                await user.send(message);
                console.log(`Auto clock in performed for ${user.username}`);
            }
        }
    }

    // Standard reminder message sender
    async function sendReminderMessage(userId, message) {
        try {
            const user = await client.users.fetch(userId);
            if (user) {
                await user.send(message);
                console.log(`Reminder sent to ${user.username}: ${message}`);
            }
        } catch (error) {
            console.error('Failed to send reminder:', error);
        }
    }

    // Channel reminder function
    async function sendChannelReminder(channelId, message) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel) {
                await channel.send(message);
                console.log(`Channel reminder sent to ${channel.name}: ${message}`);
            }
        } catch (error) {
            console.error(`Failed to send channel reminder to ${channelId}:`, error);
        }
    }

    // Welcome message function
    async function sendWelcomeMessage(userId) {
        const welcomeMessage = 'Hiii, love! I missed you!';
        await sendReminderMessage(userId, welcomeMessage);
    }

    // Handle button interactions
    function setupButtonHandlers() {
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton()) return;
            
            if (interaction.customId === 'clockout_button') {
                await interaction.deferReply();
                const success = await clockOut();
                if (success) {
                    await interaction.editReply('You have been clocked out successfully! ✅');
                } else {
                    await interaction.editReply('Failed to clock out. Please try again or use the /clockout command. ❌');
                }
            }
            
            if (interaction.customId === 'clockin_button') {
                const command = client.application.commands.cache.find(cmd => cmd.name === 'clockin');
                if (command) {
                    await interaction.reply({ content: 'Please use the /clockin command to select a project.', ephemeral: true });
                }
            }
        });
    }

    // Schedule all reminders
    const scheduleReminders = () => {
        console.log('Scheduling reminders, channel notifications, and Clockify automations...');
        
        // Schedule regular reminders
        importantTimes.forEach(({ time, message }) => {
            const [hour, minute] = time.split(':');
            cron.schedule(`${minute} ${hour} * * *`, () => {
                sendReminderMessage(USER_ID, message);
            });
        });
        
        // Schedule enhanced reminders with Clockify actions
        enhancedReminders.forEach(({ time, action, message }) => {
            const [hour, minute] = time.split(':');
            cron.schedule(`${minute} ${hour} * * *`, () => {
                switch (action) {
                    case 'clockOutReminder':
                        handleClockOutReminder(USER_ID, message);
                        break;
                    case 'clockInReminder':
                        handleClockInReminder(USER_ID, message);
                        break;
                    case 'autoClockOut':
                        handleAutoClockOut(USER_ID, message);
                        break;
                    case 'autoClockIn':
                        handleAutoClockIn(USER_ID, message);
                        break;
                }
            });
        });
        
        // Schedule channel reminders
        CHANNEL_REMINDERS.forEach(({ channelId, time, message }) => {
            const [hour, minute] = time.split(':');
            cron.schedule(`${minute} ${hour} * * *`, () => {
                sendChannelReminder(channelId, message);
            });
            console.log(`Scheduled channel reminder for ${channelId} at ${time}`);
        });
        
        // Set up button interaction handlers
        setupButtonHandlers();
        
        console.log('All reminders, channel notifications, and automations scheduled successfully!');
    };

    return {
        scheduleReminders,
        sendWelcomeMessage
    };
}

module.exports = initializeEnhancedReminders;