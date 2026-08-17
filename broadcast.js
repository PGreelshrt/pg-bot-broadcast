const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const payload = JSON.parse(process.env.CLIENT_PAYLOAD);
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

const { admin_id, progress_message_id, en_message, am_message } = payload;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== 辅助函数：更新进度消息 =====
async function updateProgress(text) {
  if (!progress_message_id) return;
  try {
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

// ===== 消息超长截断 =====
function safeTruncate(text, limit = 4000) {
  if (!text) return "";
  if (text.length > limit) {
    return text.substring(0, limit) + "\n\n⚠️ *(内容已截断)*";
  }
  return text;
}

// ===== 主广播函数 =====
async function startBroadcast() {
  console.log("🚀 工业级广播引擎启动...");

  // 提取图片标签（可选）
  const enImgMatch = en_message.match(/\[EN_IMG\]([\s\S]*?)\[\/EN_IMG\]/);
  const amImgMatch = en_message.match(/\[AM_IMG\]([\s\S]*?)\[\/AM_IMG\]/);
  const enImageUrl = enImgMatch ? enImgMatch[1].trim() : "";
  const amImageUrl = amImgMatch ? amImgMatch[1].trim() : "";

  // 清洗文本内容（移除图片标签）
  let cleanEn = safeTruncate(en_message.replace(/\[EN_IMG\]([\s\S]*?)\[\/EN_IMG\]/g, "").replace(/\[AM_IMG\]([\s\S]*?)\[\/AM_IMG\]/g, "").trim());
  let cleanAm = safeTruncate(am_message.replace(/\[EN_IMG\]([\s\S]*?)\[\/EN_IMG\]/g, "").replace(/\[AM_IMG\]([\s\S]*?)\[\/AM_IMG\]/g, "").trim());

  // 防止内容全空
  if (!cleanEn && !cleanAm) {
    cleanEn = "📢 系统通知";
    cleanAm = "📢 የስርዓት ማሳወቂያ";
  }

  let successCount = 0;
  let failCount = 0;
  let totalProcessed = 0;

  // ===== 断点续传：读取上次中断位置 =====
  let lastChatId = "0";
  try {
    const { data: lockData } = await supabase
      .from('broadcast_status')
      .select('last_processed_chat_id')
      .eq('id', 'global_lock')
      .single();

    if (lockData && lockData.last_processed_chat_id && lockData.last_processed_chat_id !== "0") {
      lastChatId = lockData.last_processed_chat_id;
      console.log(`📌 检测到断点，从 ChatID: ${lastChatId} 继续...`);
      await updateProgress(`🔄 **断点续传：** 从 ChatID: ${lastChatId} 继续发送...`);
      await delay(2000);
    }
  } catch (err) {
    console.error("读取断点失败:", err);
  }

  let hasMore = true;
  const pageSize = 500;

  try {
    while (hasMore) {
      // ===== 游标分页（Keyset Pagination） =====
      const { data: users, error } = await supabase
        .from('bot_users')
        .select('chat_id, lang, is_blocked')
        .gt('chat_id', lastChatId)
        .order('chat_id', { ascending: true })
        .limit(pageSize);

      if (error) {
        throw new Error(`Supabase 查询失败: ${error.message}`);
      }

      if (!users || users.length === 0) {
        hasMore = false;
        break;
      }

      for (const user of users) {
        if (!user.chat_id) continue;

        lastChatId = user.chat_id.toString();

        // 跳过被拉黑的用户
        if (user.is_blocked === true || user.is_blocked === 'true') {
          continue;
        }

        // 语言选择
        const userLang = user.lang ? user.lang.toLowerCase() : "am";
        let targetMessage = "";
        let targetImageUrl = "";

        if (userLang === 'en') {
          targetMessage = cleanEn || cleanAm;
          targetImageUrl = enImageUrl || amImageUrl;
        } else {
          targetMessage = cleanAm || cleanEn;
          targetImageUrl = amImageUrl || enImageUrl;
        }

        if (!targetMessage) {
          targetMessage = "📢 系统通知";
        }

        try {
          let res;
          if (targetImageUrl) {
            res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: user.chat_id,
                photo: targetImageUrl,
                caption: targetMessage,
                disable_web_page_preview: true
              })
            });
          } else {
            res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: user.chat_id,
                text: targetMessage,
                disable_web_page_preview: true
              })
            });
          }

          const result = await res.json();
          if (result.ok) {
            successCount++;
          } else {
            failCount++;
            console.warn(`❌ 失败 [${user.chat_id}]: ${result.description}`);
          }
        } catch (e) {
          failCount++;
          console.error(`💥 异常 [${user.chat_id}]:`, e.message);
        }

        totalProcessed++;
        await delay(40);

        // 每 20 条更新进度并写入断点
        if (totalProcessed % 20 === 0) {
          await updateProgress(
            `⏳ 广播发送中...\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n总进度: ${totalProcessed} 人`
          );

          await supabase
            .from('broadcast_status')
            .update({ last_processed_chat_id: lastChatId })
            .eq('id', 'global_lock');
        }
      }
    }

    // ===== 广播完成，重置断点 =====
    await updateProgress(
      `🎉 **广播执行完毕！**\n\n📊 成功: ${successCount}\n❌ 失败: ${failCount}\n总处理: ${totalProcessed} 人`
    );
    await supabase
      .from('broadcast_status')
      .update({ last_processed_chat_id: "0" })
      .eq('id', 'global_lock');

  } catch (mainErr) {
    console.error("❌ 广播异常中断:", mainErr);
    await updateProgress(
      `❌ **广播中断：** 断点已保存 (ChatID: ${lastChatId})，重新运行即可续传。`
    );
  } finally {
    // ===== 释放锁 =====
    await supabase
      .from('broadcast_status')
      .update({ status: 'idle' })
      .eq('id', 'global_lock');
    console.log("🔓 锁已释放");
  }
}

startBroadcast();
