const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendReminder() {
  console.log("⏰ Scanning for missed check-ins...");

  const todayStr = new Date().toISOString().split('T')[0];
  let page = 0;
  const pageSize = 500;
  let hasMore = true;

  while (hasMore) {
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('chat_id, last_checkin, checkin_streak, is_blocked, status, lang')
      .eq('status', 'active')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("❌ DB query failed:", error);
      return;
    }
    if (!users || users.length === 0) {
      hasMore = false;
      break;
    }

    for (const user of users) {
      if (!user.chat_id || user.is_blocked === true || user.is_blocked === 'true') continue;
      if (!user.last_checkin) continue;

      const lastDate = new Date(user.last_checkin);
      const todayDate = new Date(todayStr);
      const daysDiff = Math.floor((todayDate - lastDate) / (24 * 60 * 60 * 1000));

      if (daysDiff === 2) {
        const currentStreak = user.checkin_streak || 0;
        const displayStreak = Math.max(0, currentStreak - 1);

        const lang = (user.lang || 'en').toLowerCase();
        let reminderText = '';

        if (lang === 'am') {
          reminderText =
            `🔔 <b>የ check in ማስታወሻ</b>\n\n` +
            `ውድ ተጠቃሚ፣ ትናንት check in አምልጦዎታል:: 🤷‍♀️\n\n` +
            `⚠️ የእለት ተእለት ተከታታይ ቀናትዎ በ1 ቀን ቀንሷል። አሁን ያሉበት ተከታታይ ቀናት፦ <b>${displayStreak}</b> ቀን(ናት)::\n\n` +
            `🚀 ተጨማሪ ቅናሽን ለማስቆም እና ወደ 7 ቀናት ሽልማት ለመቀጠል እባክዎ ዛሬ check_in ያድርጉ! 👇\n\n` +
            `/check\n\n` +
            `<i>ማሳሰቢያ፦ ዛሬ አስቀድመው check_in ካደረጉ ይህንን መልዕክት ችላ ይበሉት።</i>`;
        } else {
          reminderText =
            `🔔 <b>Check-in Reminder</b>\n\n` +
            `Dear user, you missed your check-in yesterday. 🤷‍♀️\n\n` +
            `⚠️ Your streak has been reduced by 1 day. Current streak: <b>${displayStreak}</b> day(s).\n\n` +
            `🚀 Please check in today to stop further deduction and continue toward the 7-day reward! 👇\n\n` +
            `/check\n\n` +
            `<i>Note: Ignore this message if you have already checked in today.</i>`;
        }

        try {
          const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: user.chat_id,
              text: reminderText,
              parse_mode: 'HTML'  
            })
          });
          if (res.ok) {
            console.log(`✅ ${lang === 'am' ? 'Amharic' : 'English'} reminder sent to ${user.chat_id}`);
          } else {
            const err = await res.text();
            console.warn(`❌ Failed to send to ${user.chat_id}: ${err}`);
          }
        } catch (e) {
          console.error(`💥 Error for ${user.chat_id}:`, e.message);
        }

        await delay(40);
      }
    }
    page++;
  }

  console.log("🎉 Scan complete.");
}

sendReminder();
