const sweetMessages = {
  love: [
    "❤️ You make ordinary moments feel special. Having you in my life is my favorite blessing.",
    "❤️ If my heart could write a story, every beautiful chapter would have you in it.",
    "❤️ Your smile is my favorite view, your voice my favorite sound, and your love my favorite feeling.",
    "❤️ No matter how busy life gets, there will always be a quiet place in my heart just for you.",
    "❤️ Loving you feels like finding home in a person. With you, I can simply be myself.",
    "❤️ I don't need a perfect day to be happy. A little time with you is more than enough.",
    "❤️ You are the sweet thought that makes me smile when nobody else is watching.",
    "❤️ Distance may keep our hands apart, but it can never stop my heart from reaching for you.",
    "❤️ If I could give you one gift, it would be the chance to see yourself through my eyes. You would know how precious you are.",
    "❤️ Every day with you gives me another reason to be grateful. I would choose you all over again.",
    "❤️ You bring warmth to my heart and peace to my thoughts. Thank you for being wonderfully you.",
    "❤️ My favorite part of today is knowing you are in my life. You mean more to me than words can hold.",
  ],
  goodnight: [
    "🌙 Good night, my love. Let the worries of today fade away, and let sweet dreams bring you peace.",
    "🌙 Before you close your eyes, remember that you are loved. Sleep softly and wake with a happy heart.",
    "🌙 Good night, sweetheart. If I could, I would tuck you in with a hug and a kiss on your forehead.",
    "🌙 The stars may light up the sky, but thoughts of you light up my heart. Sleep well, my favorite person.",
    "🌙 Rest your beautiful heart tonight. You have done enough today, and tomorrow can wait until morning.",
    "🌙 Good night, darling. May your pillow feel soft, your dreams feel sweet, and your morning feel bright.",
    "🌙 I wish I could hold your hand until you fall asleep. For now, take this message as a little goodnight hug.",
    "🌙 Close your eyes knowing that someone is smiling just thinking of you. Sweet dreams, my love.",
    "🌙 Good night to the one who makes my days sweeter. May your dreams be as lovely as your smile.",
    "🌙 Let the night bring you comfort and gentle rest. I will be wishing you happiness until the sun rises.",
    "🌙 You are my last sweet thought before sleep. Good night, love; I hope tomorrow gives you many reasons to smile.",
    "🌙 Sleep peacefully, sweetheart. Whatever today brought, you deserve a night full of calm and beautiful dreams.",
  ],
  goodmorning: [
    "🌅 Good morning, my love. May your day begin with a smile and bring you a hundred little reasons to keep it.",
    "🌅 Wake up, sweetheart! A new day is here, and the world is a little brighter with you in it.",
    "🌅 Good morning to my favorite person. I hope today is kind to you and full of lovely surprises.",
    "🌅 If I were beside you, this message would be a warm hug. Good morning, darling; have a beautiful day.",
    "🌅 The sun is up, but your smile is still my favorite sunshine. Good morning, love.",
    "🌅 Start today knowing you are cherished. Take a deep breath, smile, and give yourself a gentle beginning.",
    "🌅 Good morning, sweetheart. May your coffee be warm, your thoughts be peaceful, and your heart be happy.",
    "🌅 You were my first sweet thought this morning. I hope your day feels as special as you make me feel.",
    "🌅 A fresh morning, a fresh chance to smile. Good morning, my love; I am cheering for you today.",
    "🌅 Good morning, darling. I wish you little victories, kind people, and moments that make your heart happy.",
    "🌅 Sending you a little love with the morning light. May today be gentle, joyful, and full of hope.",
    "🌅 Open your eyes to a brand-new day, sweetheart. You are loved, you are valued, and I hope wonderful things find you.",
  ],
};

// A shuffled cycle uses every message before recycling, with no consecutive
// repeat at the cycle boundary. State is bounded and contains no chat data.
function createMessagePicker(messages, random = Math.random) {
  if (messages.length < 2 || new Set(messages).size !== messages.length) {
    throw new Error("A message pool needs at least two distinct messages.");
  }
  let remaining = [];
  let previous;

  return () => {
    if (remaining.length === 0) {
      remaining = [...messages];
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      const last = remaining.length - 1;
      if (remaining[last] === previous) {
        [remaining[0], remaining[last]] = [remaining[last], remaining[0]];
      }
    }
    previous = remaining.pop();
    return previous;
  };
}

module.exports = { sweetMessages, createMessagePicker };
