const cron = require('node-cron');

// This function will be initialized with the client from main file
function initializeReminders(client) {
    const USER_ID = process.env.DISCORD_USER_ID;

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

    async function sendWelcomeMessage(userId) {
        const welcomeMessage = '👋 Welcome back, Orland! Ready for another productive day?';
        await sendReminderMessage(userId, welcomeMessage);
    }

    // Schedule all reminders
    const scheduleReminders = () => {
        console.log('Scheduling reminders...');
        importantTimes.forEach(({ time, message }) => {
            const [hour, minute] = time.split(':');
            cron.schedule(`${minute} ${hour} * * *`, () => {
                sendReminderMessage(USER_ID, message);
            });
        });
        console.log('Reminders scheduled successfully!');
    };

    return {
        scheduleReminders,
        sendWelcomeMessage
    };
}

module.exports = initializeReminders;