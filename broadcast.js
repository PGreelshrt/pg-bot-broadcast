const { createClient } = require('@supabase/supabase-js');

// 1. 初始化环境变量 (Node 24 全面原生支持 fetch，直接剔除 node-fetch)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const payload = JSON.parse(process.env.CLIENT_PAYLOAD);
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

const { admin_id, progress_message_id, en_message, am_message } = payload;

// 辅助函数：延迟执行（用于严格控频）
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数：更新管理员的进度消息
async function updateProgress(text) {
  if (!progress_message_id) return;
  try {
    // 采用 Node 24 全新原生全局 fetch 发送
    await fetch(`https://telegram.org{TG_TOKEN}/editMessageText`, {
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
  
  let successCount = 0;
  let failCount = 0;
  let totalProcessed = 0;

  while (hasMore) {
    // 让 Supabase 在服务端直接按 chat_id 升序
    const { data: users, error } = await supabase
      .from('bot_users')
      .select('chat_id, lang, is_blocked')
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('chat_id', { ascending: true });

    if (error) {
      console.error("读取 Supabase 出错:", error);
      await updateProgress(`❌ 广播中断：无法读取数据库。错误: ${error.message}`);
      return;
    }

    if (!users || users.length === 0) {
      hasMore = false;
      break;
    }

    // 循环发送消息
    for (const user of users) {
      if (!user.chat_id) continue;
      
      // 黑名单拦截
      if (user.is_blocked === true || user.is_blocked === 'true') {
        console.log(`跳过被拉黑的用户: ${user.chat_id}`);
        continue; 
      }
      
      // 语言清洗（默认发送 AM）
      let targetMessage = am_message; 
      if (user.lang && user.lang.toLowerCase() === 'en' && en_message) {
        targetMessage = en_message;
      } else if (!targetMessage) {
        targetMessage = en_message || am_message; 
      }

      try {
        const res = await fetch(`https://telegram.org{TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.chat_id,
            text: targetMessage
          })
        });
        
        const result = await res.json();
        if (result.ok) {
          successCount++;
        } else {
          failCount++;
          console.warn(`发送失败 [ChatID: ${user.chat_id}]:`, result.description);
        }
      } catch (e) {
        failCount++;
        console.error(`请求异常 [ChatID: ${user.chat_id}]:`, e);
      }

      totalProcessed++;

      // ⚡ 严格控频：每秒最高 25 条
      await delay(40);

      // 每处理 20 条消息，给管理员更新一次界面进度
      if (totalProcessed % 20 === 0) {
        await updateProgress(`⏳ 广播发送中...\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n总进度: 已处理 ${totalProcessed} 个用户`);
      }
    }

    page++;
  }

  // 广播完成最终通知
  await updateProgress(`🎉 **广播执行完毕！**\n\n📊 **统计结果：**\n- 成功送达: ${successCount} 人\n- 发送失败: ${failCount} 人\n- 累计处理: ${totalProcessed} 人`);
  console.log("广播任务全部结束。");
}

startBroadcast();
