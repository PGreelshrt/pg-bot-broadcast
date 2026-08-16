const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const payload = JSON.parse(process.env.CLIENT_PAYLOAD);
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

const { admin_id, progress_message_id, en_message, am_message } = payload;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function updateProgress(text) {
  if (!progress_message_id) return;
  try {
    // ✅ 修正 URL
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: admin_id,
        message_id: progress_message_id,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error("更新进度失败:", err);
  }
}

async function startBroadcast() {
  console.log("广播开始初始化...");
  let page = 0;
  const pageSize = 500;
  let hasMore = true;
  let successCount = 0, failCount = 0, totalProcessed = 0;

  while (hasMore) {
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('chat_id, lang, is_blocked')
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('chat_id', { ascending: true });

    if (error) {
      console.error("读取 Supabase 出错:", error);
      await updateProgress(`❌ 广播中断：${error.message}`);
      return;
    }

    if (!users || users.length === 0) {
      hasMore = false;
      break;
    }

    for (const user of users) {
      if (!user.chat_id) continue;
      if (user.is_blocked === true || user.is_blocked === 'true') {
        console.log(`跳过被拉黑用户: ${user.chat_id}`);
        continue;
      }

      let targetMessage = am_message;
      if (user.lang && user.lang.toLowerCase() === 'en' && en_message) {
        targetMessage = en_message;
      } else if (!targetMessage) {
        targetMessage = en_message || am_message;
      }

      try {
        // ✅ 修正 URL 并添加 disable_web_page_preview
        const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.chat_id,
            text: targetMessage,
            disable_web_page_preview: true
          })
        });
        const result = await res.json();
        if (result.ok) {
          successCount++;
        } else {
          failCount++;
          console.warn(`发送失败 [${user.chat_id}]:`, result.description);
        }
      } catch (e) {
        failCount++;
        console.error(`请求异常 [${user.chat_id}]:`, e);
      }

      totalProcessed++;
      await delay(40);

      if (totalProcessed % 20 === 0) {
        await updateProgress(`⏳ 广播发送中...\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n总进度: ${totalProcessed}`);
      }
    }
    page++;
  }

  await updateProgress(`🎉 **广播完成！**\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n总处理: ${totalProcessed}`);
  console.log("广播任务结束。");
}

startBroadcast();
