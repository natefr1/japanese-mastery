// Authored 生活 quests (offline, original content). Multiple acceptable answers per
// step; tone affects the relationship only through social behaviour, never grammar.
import type { QuestDef } from "./quests";

const yes = ["はい", "お願い", "おねがい", "ええ", "うん", "ください"];
const no = ["大丈夫", "だいじょうぶ", "いいです", "結構", "けっこう", "いらない", "いりません", "いいえ"];

export const konbini: QuestDef = {
  id: "konbini-first-purchase",
  title: "First konbini run",
  titleJp: "はじめてのコンビニ",
  location: "konbini",
  summary: "Buy lunch at the convenience store and handle whatever the cashier asks.",
  minLevel: 1,
  start: "enter",
  objectives: [
    { id: "greet", text: "Hand over your items naturally" },
    { id: "q-warm", text: "Answer: heat the bento?", dynamicFrom: "q-warm" },
    { id: "q-bag", text: "Answer: need a bag?", dynamicFrom: "q-bag" },
    { id: "q-hashi", text: "Answer: chopsticks?", dynamicFrom: "q-hashi" },
    { id: "q-point", text: "Answer: point card?", dynamicFrom: "q-point" },
    { id: "total", text: "Understand the total" },
    { id: "pay", text: "Pay" },
  ],
  success: (met) => met.has("pay") && ["q-warm", "q-bag", "q-hashi", "q-point"].filter((q) => met.has(q)).length >= 2,
  passport: { kind: "purchase", title: "Bought lunch at a konbini (simulated)", detail: "Handled the cashier's questions in Japanese." },
  phrases: [
    { t: "温めますか", r: "あたためますか", m: "Shall I heat it up?" },
    { t: "袋", r: "ふくろ", m: "bag" },
    { t: "お箸", r: "おはし", m: "chopsticks" },
    { t: "お会計", r: "おかいけい", m: "the bill / total" },
    { t: "大丈夫です", r: "だいじょうぶです", m: "I'm fine (no thanks)" },
    { t: "一膳", r: "いちぜん", m: "one pair (of chopsticks)" },
  ],
  nodes: {
    enter: {
      id: "enter",
      lines: [
        { speaker: "narration", jp: "（ピロリロリン♪）", en: "(The konbini door chime plays.)" },
        { speaker: "cashier", jp: "いらっしゃいませー！", en: "Welcome!", gloss: [{ t: "いらっしゃいませ", m: "welcome (to a shop)" }] },
        { speaker: "narration", jp: "お弁当と飲み物を持って、レジに行く。", en: "You take a bento and a drink to the register.", gloss: [{ t: "お弁当", r: "おべんとう", m: "boxed lunch" }, { t: "レジ", m: "register" }] },
      ],
      choices: [
        { jp: "お願いします。", en: "Here you go (please).", tone: "natural", next: "scan", objective: "greet", feedback: "Perfect. お願いします as you hand items over is exactly what people say." },
        { jp: "これ、ください。", en: "This, please.", tone: "ok", next: "scan", objective: "greet", feedback: "Understandable, but at a konbini you've already picked the items. お願いします sounds smoother." },
        { jp: "こんにちは！", en: "Hello!", tone: "ok", next: "scan", objective: "greet", feedback: "Friendly! Cashiers don't expect a greeting back, though; a nod or お願いします is typical." },
      ],
    },
    scan: { id: "scan", lines: [{ speaker: "narration", jp: "（ピッ、ピッ）", en: "(beep, beep)" }], random: { pool: ["q-warm", "q-bag", "q-hashi", "q-point"], count: 3, then: "total" } },
    "q-warm": {
      id: "q-warm",
      lines: [{ speaker: "cashier", jp: "こちらのお弁当、温めますか？", en: "Shall I heat up this bento?", gloss: [{ t: "温める", r: "あたためる", m: "to warm up" }, { t: "こちら", m: "this (polite)" }] }],
      choices: [
        { jp: "はい、お願いします。", en: "Yes, please.", tone: "natural", next: "@continue", objective: "q-warm" },
        { jp: "いえ、大丈夫です。", en: "No, I'm fine.", tone: "natural", next: "@continue", objective: "q-warm", feedback: "大丈夫です is the standard polite 'no thanks'." },
        { jp: "温めます。", en: "I will heat it.", tone: "awkward", next: "@continue", feedback: "温めます means 'I will heat it', as if you're offering. Answer with はい、お願いします or 大丈夫です." },
        { jp: "すみません、もう一度お願いします。", en: "Sorry, once more please.", tone: "natural", next: "q-warm-again", objective: "recover", feedback: "Asking for a repeat is a real skill. Well done." },
      ],
      typed: { rules: [{ patterns: yes, tone: "natural", next: "@continue", objective: "q-warm" }, { patterns: no, tone: "natural", next: "@continue", objective: "q-warm" }], fallback: { next: "@continue", feedback: "The cashier asked whether to heat (温める) the bento. Say はい、お願いします or 大丈夫です." }, placeholder: "はい、お願いします" },
    },
    "q-warm-again": {
      id: "q-warm-again",
      lines: [{ speaker: "cashier", jp: "お弁当を、温めますか？（電子レンジを指さす）", en: "Shall I heat the bento? (points at the microwave)", gloss: [{ t: "電子レンジ", r: "でんしレンジ", m: "microwave" }] }],
      choices: [
        { jp: "あ、はい！お願いします。", en: "Oh, yes! Please.", tone: "natural", next: "@continue", objective: "q-warm" },
        { jp: "大丈夫です。", en: "No thanks.", tone: "natural", next: "@continue", objective: "q-warm" },
      ],
    },
    "q-bag": {
      id: "q-bag",
      lines: [{ speaker: "cashier", jp: "袋はご利用ですか？", en: "Will you be using a bag?", gloss: [{ t: "袋", r: "ふくろ", m: "bag" }, { t: "ご利用", r: "ごりよう", m: "use (honorific)" }] }],
      choices: [
        { jp: "はい、お願いします。", en: "Yes, please.", tone: "natural", next: "@continue", objective: "q-bag", feedback: "Note: bags cost a few yen in Japan." },
        { jp: "いいえ、大丈夫です。", en: "No, I'm fine.", tone: "natural", next: "@continue", objective: "q-bag" },
        { jp: "はい、ご利用です。", en: "Yes, I use (honorific).", tone: "awkward", next: "@continue", objective: "q-bag", feedback: "ご利用 is honorific: the cashier uses it about YOU. Don't echo it about yourself. Just say はい、お願いします." },
      ],
      typed: { rules: [{ patterns: yes, tone: "natural", next: "@continue", objective: "q-bag" }, { patterns: no, tone: "natural", next: "@continue", objective: "q-bag" }], fallback: { next: "@continue", feedback: "They asked if you want a bag (袋). はい、お願いします / 大丈夫です." }, placeholder: "大丈夫です" },
    },
    "q-hashi": {
      id: "q-hashi",
      lines: [{ speaker: "cashier", jp: "お箸はおつけしますか？", en: "Shall I include chopsticks?", gloss: [{ t: "お箸", r: "おはし", m: "chopsticks" }, { t: "おつけする", m: "to include/attach (humble)" }] }],
      choices: [
        { jp: "はい、一膳お願いします。", en: "Yes, one pair please.", tone: "natural", next: "@continue", objective: "q-hashi", feedback: "膳 (ぜん) is the counter for pairs of chopsticks. Nice." },
        { jp: "はい、お願いします。", en: "Yes, please.", tone: "natural", next: "@continue", objective: "q-hashi" },
        { jp: "いりません。", en: "I don't need them.", tone: "ok", next: "@continue", objective: "q-hashi", feedback: "Clear, but a bit blunt. 大丈夫です is softer." },
        { jp: "お箸です。", en: "It's chopsticks.", tone: "awkward", next: "@continue", feedback: "That just names the item. Answer the yes/no question: はい、お願いします." },
      ],
      typed: { rules: [{ patterns: yes, tone: "natural", next: "@continue", objective: "q-hashi" }, { patterns: no, tone: "natural", next: "@continue", objective: "q-hashi" }], fallback: { next: "@continue", feedback: "They asked about chopsticks (お箸). はい、お願いします / 大丈夫です." }, placeholder: "はい、お願いします" },
    },
    "q-point": {
      id: "q-point",
      lines: [{ speaker: "cashier", jp: "ポイントカードはお持ちですか？", en: "Do you have a point card?", gloss: [{ t: "お持ちですか", r: "おもちですか", m: "do you have (honorific)" }] }],
      choices: [
        { jp: "いいえ、持ってないです。", en: "No, I don't have one.", tone: "natural", next: "@continue", objective: "q-point" },
        { jp: "大丈夫です。", en: "I'm fine.", tone: "natural", next: "@continue", objective: "q-point", feedback: "Very common way to wave this off." },
        { jp: "はい、持ちます。", en: "Yes, I will hold it.", tone: "awkward", next: "@continue", feedback: "持ちます = I will hold/carry. To say you have one: 持ってます." },
      ],
      typed: { rules: [{ patterns: [...no, "持ってない", "もってない", "ないです"], tone: "natural", next: "@continue", objective: "q-point" }, { patterns: ["持ってます", "もってます", "あります"], tone: "natural", next: "@continue", objective: "q-point" }], fallback: { next: "@continue", feedback: "Point card question. いいえ、持ってないです or 大丈夫です." }, placeholder: "持ってないです" },
    },
    total: {
      id: "total",
      lines: [
        { speaker: "cashier", jp: "お会計、六百八十円になります。", en: "Your total comes to 680 yen.", gloss: [{ t: "お会計", r: "おかいけい", m: "bill/total" }, { t: "六百八十円", r: "ろっぴゃくはちじゅうえん", m: "680 yen" }] },
        { speaker: "narration", jp: "（いくら？数字で入力してね）", en: "(How much? Type the number.)" },
      ],
      typed: {
        rules: [{ patterns: ["680", "ろっぴゃくはちじゅう", "六百八十"], tone: "natural", next: "pay", objective: "total" }],
        fallback: { next: "pay", feedback: "It was 六百八十円 (ろっぴゃくはちじゅう = 680). ろっぴゃく = 600 (sound change!), はちじゅう = 80." },
        placeholder: "680",
      },
    },
    pay: {
      id: "pay",
      lines: [{ speaker: "cashier", jp: "お支払いはどうされますか？", en: "How will you be paying?", gloss: [{ t: "お支払い", r: "おしはらい", m: "payment" }] }],
      choices: [
        { jp: "カードでお願いします。", en: "By card, please.", tone: "natural", next: "paid", objective: "pay" },
        { jp: "現金で。", en: "Cash.", tone: "natural", next: "paid", objective: "pay" },
        { jp: "PayPayで。", en: "With PayPay.", tone: "natural", next: "paid", objective: "pay", feedback: "QR payments like PayPay are everywhere in Japan." },
      ],
      typed: { rules: [{ patterns: ["カード", "げんきん", "現金", "ペイ", "paypay", "スイカ", "suica"], tone: "natural", next: "paid", objective: "pay" }], fallback: { next: "pay", feedback: "Say how you'll pay: カードで / 現金で / PayPayで." }, placeholder: "カードで" },
    },
    paid: {
      id: "paid",
      lines: [{ speaker: "cashier", jp: "ありがとうございましたー！", en: "Thank you very much!" }],
      choices: [
        { jp: "（軽く会釈して出る）", en: "(Give a small nod and leave.)", tone: "natural", next: "end", feedback: "A nod is completely normal here." },
        { jp: "どうも。", en: "Thanks.", tone: "natural", next: "end" },
        { jp: "ありがとうございます！", en: "Thank you!", tone: "natural", next: "end" },
      ],
    },
    end: { id: "end", lines: [{ speaker: "narration", jp: "温かいお弁当を手に、店を出た。", en: "You leave with your lunch." }], end: { success: true } },
  },
};

export const harutoInvite: QuestDef = {
  id: "haruto-gaming-invite",
  title: "Haruto's game night",
  titleJp: "ハルトからのお誘い",
  location: "phone",
  character: "haruto",
  summary: "Haruto texts you about a horror game tonight. Make plans and keep the conversation going.",
  minLevel: 1,
  start: "h1",
  objectives: [
    { id: "reply", text: "Reply to Haruto naturally" },
    { id: "accept", text: "Agree on playing (or suggest another time)" },
    { id: "mic", text: "Answer his question about your mic" },
    { id: "follow", text: "Keep the conversation going (react or ask something)" },
  ],
  success: (met) => met.has("accept") && met.has("mic"),
  passport: { kind: "text_plans", title: "Made gaming plans over text (simulated)", detail: "Agreed on a time and setup with Haruto in casual Japanese." },
  phrases: [
    { t: "ひま", r: "ひま", m: "free (time)" },
    { t: "新作", r: "しんさく", m: "new release" },
    { t: "ボイチャ", m: "voice chat" },
    { t: "ビビり", m: "scaredy-cat" },
    { t: "おけ", m: "OK (texting)" },
  ],
  nodes: {
    h1: {
      id: "h1",
      lines: [{ speaker: "haruto", jp: "おつー！今ひま？", en: "Yo! You free right now?", gloss: [{ t: "おつ", m: "hey / good work (from お疲れ)" }, { t: "ひま", m: "free, not busy" }] }],
      choices: [
        { jp: "ひまだよ！どうした？", en: "I'm free! What's up?", tone: "natural", next: "h2", objective: "reply", rel: { haruto: 1 } },
        { jp: "はい、暇です。", en: "Yes, I am free.", tone: "ok", next: "h2", objective: "reply", feedback: "Grammatically perfect, but です/ます with a close friend sounds distant. Friends text in plain form: ひまだよ！" },
        { jp: "なに？", en: "What?", tone: "ok", next: "h2", objective: "reply", feedback: "Fine between friends, just a little curt. Adding どうした？ sounds warmer." },
      ],
      typed: { rules: [{ patterns: ["ひま", "暇", "大丈夫", "だいじょうぶ", "いいよ", "どうした"], tone: "natural", next: "h2", objective: "reply" }], fallback: { next: "h2", feedback: "He asked if you're free (ひま). e.g. ひまだよ！どうした？" }, placeholder: "ひまだよ！" },
    },
    h2: {
      id: "h2",
      lines: [
        { speaker: "haruto", jp: "今夜9時から新作のホラゲーやるんだけど、一緒にやらない？", en: "I'm playing the new horror game from 9 tonight. Wanna play together?", gloss: [{ t: "新作", r: "しんさく", m: "new release" }, { t: "ホラゲー", m: "horror game" }, { t: "〜んだけど", m: "(sets up context)" }] },
        { speaker: "haruto", jp: "ボイチャつなぎながら！", en: "On voice chat!", gloss: [{ t: "ボイチャ", m: "voice chat" }, { t: "つなぐ", m: "to connect" }, { t: "〜ながら", m: "while ..." }] },
      ],
      choices: [
        { jp: "いいね！やろう！", en: "Sounds good! Let's do it!", tone: "natural", next: "h3", objective: "accept", rel: { haruto: 2 } },
        { jp: "ホラーはちょっと苦手なんだよね…でもやってみる！", en: "I'm kinda bad with horror... but I'll try!", tone: "natural", next: "h3", objective: "accept", rel: { haruto: 3 }, memory: { character: "haruto", fact: "Player is a bit scared of horror games but willing to try" }, feedback: "Sharing a feeling and then agreeing sounds very natural." },
        { jp: "9時は無理。10時はどう？", en: "9 doesn't work. How about 10?", tone: "natural", next: "h3-ten", objective: "accept", flag: "ten", feedback: "Great counter-proposal: 〜はどう？ = how about...?" },
        { jp: "行きます。", en: "I will go.", tone: "awkward", next: "h3", objective: "accept", feedback: "行く doesn't fit joining an online game. Use やる (play) → やる！/ やろう！ And plain form with a friend." },
      ],
      typed: { rules: [{ patterns: ["いいね", "やろう", "やる", "おけ", "オッケー", "いいよ", "うん", "もちろん"], tone: "natural", next: "h3", objective: "accept", rel: { haruto: 2 } }], fallback: { next: "h3", feedback: "He invited you to play (一緒にやらない？). To accept: いいね！やろう！" }, placeholder: "いいね！やろう！" },
    },
    h3: {
      id: "h3",
      lines: [{ speaker: "haruto", jp: "よっしゃ！じゃあ9時にDiscordで！あ、マイクある？", en: "Yes! See you on Discord at 9! Oh, do you have a mic?", gloss: [{ t: "よっしゃ", m: "alright! / yes!" }, { t: "マイク", m: "mic" }] }],
      choices: [
        { jp: "あるよ！", en: "Yep, I do!", tone: "natural", next: "h4", objective: "mic" },
        { jp: "あるある！この前新しいの買った！", en: "Yes! I just bought a new one!", tone: "natural", next: "h4", objective: "mic", rel: { haruto: 1 }, memory: { character: "haruto", fact: "Player recently bought a new mic" } },
        { jp: "マイクはあります。", en: "I do have a mic.", tone: "ok", next: "h4", objective: "mic", feedback: "Correct but stiff. Casual あるよ！ fits texting a friend." },
      ],
      typed: { rules: [{ patterns: ["ある", "持って", "もって", "うん"], tone: "natural", next: "h4", objective: "mic" }, { patterns: ["ない", "持ってない"], tone: "natural", next: "h4", objective: "mic", feedback: "No mic? Then チャットで参加する (join via chat) works too." }], fallback: { next: "h4", feedback: "マイクある？ = do you have a mic? Answer あるよ / ないんだよね." }, placeholder: "あるよ！" },
    },
    "h3-ten": {
      id: "h3-ten",
      lines: [{ speaker: "haruto", jp: "10時ね、おけ！じゃあ10時にDiscordで！あ、マイクある？", en: "10, got it! Discord at 10 then! Oh, do you have a mic?", gloss: [{ t: "おけ", m: "OK (texting)" }] }],
      choices: [
        { jp: "あるよ！", en: "Yep!", tone: "natural", next: "h4", objective: "mic" },
        { jp: "あるある！この前新しいの買った！", en: "Yes! I just bought a new one!", tone: "natural", next: "h4", objective: "mic", rel: { haruto: 1 }, memory: { character: "haruto", fact: "Player recently bought a new mic" } },
      ],
    },
    h4: {
      id: "h4",
      lines: [{ speaker: "haruto", jp: "完璧。ちなみに俺、めっちゃビビりだから叫んだらごめんｗ", en: "Perfect. FYI I'm a huge scaredy-cat, so sorry if I scream lol", gloss: [{ t: "ちなみに", m: "by the way" }, { t: "ビビり", m: "scaredy-cat" }, { t: "叫ぶ", r: "さけぶ", m: "to scream" }, { t: "ｗ", m: "lol" }] }],
      choices: [
        { jp: "大丈夫、俺も叫ぶと思うｗ", en: "No worries, I'll probably scream too lol", tone: "natural", next: "h5", objective: "follow", rel: { haruto: 2 } },
        { jp: "了解！楽しみ！", en: "Got it! Can't wait!", tone: "natural", next: "h5", objective: "follow", rel: { haruto: 1 } },
        { jp: "うるさいのは無理です。", en: "I can't stand loud people.", tone: "rude", next: "h5", rel: { haruto: -2 }, feedback: "The grammar is fine, but it's cold. He's joking, so joking back keeps things friendly." },
      ],
      typed: { rules: [{ patterns: ["ｗ", "w", "笑", "大丈夫", "楽しみ", "了解", "りょうかい", "俺も", "私も", "僕も"], tone: "natural", next: "h5", objective: "follow", rel: { haruto: 1 } }], fallback: { next: "h5", feedback: "He made a joke about screaming. React: 大丈夫、俺も叫ぶと思うｗ" }, placeholder: "俺も叫ぶと思うｗ" },
    },
    h5: {
      id: "h5",
      lines: [{ speaker: "haruto", jp: "じゃあ後でな！", en: "Catch you later!" }],
      choices: [
        { jp: "後でね！", en: "Later!", tone: "natural", next: "end" },
        { jp: "そういえば、何人でやるの？", en: "Oh, how many people are playing?", tone: "natural", next: "h6", objective: "follow", rel: { haruto: 1 }, feedback: "Asking a follow-up question shows interest. That's a social skill the 生活 boss battles test." },
      ],
    },
    h6: {
      id: "h6",
      lines: [{ speaker: "haruto", jp: "俺らとレンの3人！あいつ、ゲーム下手だけど面白いよｗ", en: "You, me and Ren, so three! He's bad at games but he's funny lol", gloss: [{ t: "俺ら", r: "おれら", m: "us (casual, masculine)" }, { t: "下手", r: "へた", m: "bad at" }] }],
      choices: [{ jp: "いいね、楽しみ！", en: "Nice, can't wait!", tone: "natural", next: "end", memory: { character: "haruto", fact: "Player agreed to game with Haruto and Ren" } }],
    },
    end: { id: "end", lines: [{ speaker: "narration", jp: "（ハルトがスタンプを送った：👍）", en: "(Haruto sent a thumbs-up sticker.)" }], end: { success: true } },
  },
};

export const mikaPlans: QuestDef = {
  id: "mika-weekend-plans",
  title: "Weekend plans with Mika",
  titleJp: "ミカと週末の予定",
  location: "phone",
  character: "mika",
  summary: "Mika wants to try a new café. Agree on a day, time and meeting place, all by text.",
  minLevel: 1,
  start: "m1",
  objectives: [
    { id: "reply", text: "Reply to Mika" },
    { id: "accept", text: "Respond to the invitation" },
    { id: "time", text: "Agree on a time" },
    { id: "place", text: "Agree on where to meet" },
    { id: "confirm", text: "Confirm the plan" },
  ],
  success: (met) => ["accept", "time", "place"].every((o) => met.has(o)),
  passport: { kind: "text_plans", title: "Coordinated an outing over text (simulated)", detail: "Set a day, time and meeting spot with Mika." },
  phrases: [
    { t: "週末", r: "しゅうまつ", m: "weekend" },
    { t: "予定", r: "よてい", m: "plans" },
    { t: "改札", r: "かいさつ", m: "ticket gates" },
    { t: "待ち合わせ", r: "まちあわせ", m: "meeting up (at a place)" },
    { t: "南口", r: "みなみぐち", m: "south exit" },
  ],
  nodes: {
    m1: {
      id: "m1",
      lines: [{ speaker: "mika", jp: "ねえねえ、週末なにしてる？🥺", en: "Hey hey, what are you doing this weekend?", gloss: [{ t: "ねえねえ", m: "hey (getting attention)" }, { t: "週末", r: "しゅうまつ", m: "weekend" }] }],
      choices: [
        { jp: "特に予定ないよ！どうしたの？", en: "No plans! What's up?", tone: "natural", next: "m2", objective: "reply", rel: { mika: 1 } },
        { jp: "土曜日はバイト。日曜日はひまだよ！", en: "Work on Saturday. Sunday I'm free!", tone: "natural", next: "m2", objective: "reply", flag: "sat-busy", memory: { character: "mika", fact: "Player has a part-time job on Saturdays" } },
        { jp: "週末は寝ます。", en: "I will sleep on the weekend.", tone: "ok", next: "m2", objective: "reply", feedback: "Honest, but it can sound like a brush-off. Add どうしたの？ to show you're open." },
      ],
      typed: { rules: [{ patterns: ["ない", "ひま", "暇", "どうした", "空いて", "あいて"], tone: "natural", next: "m2", objective: "reply" }], fallback: { next: "m2", feedback: "She asked what you're doing this weekend. e.g. 特に予定ないよ！" }, placeholder: "特に予定ないよ！" },
    },
    m2: {
      id: "m2",
      lines: [{ speaker: "mika", jp: "駅前に新しいカフェができたんだけど、一緒に行かない？パンケーキがめっちゃ美味しそうなの！", en: "A new café opened by the station, wanna go together? The pancakes look super good!", gloss: [{ t: "駅前", r: "えきまえ", m: "in front of the station" }, { t: "できた", m: "opened (was made)" }, { t: "行かない？", m: "want to go? (invitation)" }, { t: "美味しそう", r: "おいしそう", m: "looks delicious" }] }],
      choices: [
        { jp: "行きたい！いつにする？", en: "I wanna go! When should we do it?", tone: "natural", next: "m3", objective: "accept", rel: { mika: 2 } },
        { jp: "パンケーキはそんなに好きじゃないけど、カフェは行きたい！", en: "I'm not huge on pancakes, but I'd love to go to the café!", tone: "natural", next: "m3", objective: "accept", rel: { mika: 1 }, memory: { character: "mika", fact: "Player isn't a big fan of pancakes" } },
        { jp: "行かない。", en: "Not going.", tone: "rude", next: "decline", rel: { mika: -2 }, feedback: "A flat 行かない。 is a hard no. Rising 行かない？ is the invitation. To decline kindly: ごめん、その日はちょっと…" },
      ],
      typed: { rules: [{ patterns: ["行きたい", "いきたい", "行く", "いく", "いいね", "いいよ", "行こう", "いこう"], tone: "natural", next: "m3", objective: "accept", rel: { mika: 2 } }, { patterns: ["ごめん", "ちょっと"], tone: "natural", next: "decline", feedback: "A polite decline. That's a valid choice." }], fallback: { next: "m3", feedback: "She invited you (一緒に行かない？). To accept: 行きたい！" }, placeholder: "行きたい！" },
    },
    decline: { id: "decline", lines: [{ speaker: "mika", jp: "そっか、残念…また今度ね！", en: "Oh, too bad... next time then!" }], end: { success: false } },
    m3: {
      id: "m3",
      lines: [
        { speaker: "mika", jp: "じゃあ日曜日の2時はどう？", en: "How about Sunday at 2?", ifFlag: "sat-busy" },
        { speaker: "mika", jp: "土曜日の2時はどう？", en: "How about Saturday at 2?", unlessFlag: "sat-busy", gloss: [{ t: "〜はどう？", m: "how about ...?" }] },
      ],
      choices: [
        { jp: "いいよ！2時ね。", en: "Sure! 2 o'clock.", tone: "natural", next: "m4", objective: "time" },
        { jp: "2時はちょっと早いかな…3時は？", en: "2 is a bit early... how about 3?", tone: "natural", next: "m3b", objective: "time", feedback: "Nice soft counter: ちょっと〜かな… softens the no." },
      ],
      typed: { rules: [{ patterns: ["いいよ", "2時", "２時", "にじ", "おけ", "オッケー", "大丈夫"], tone: "natural", next: "m4", objective: "time" }, { patterns: ["3時", "３時", "さんじ"], tone: "natural", next: "m3b", objective: "time" }], fallback: { next: "m3", feedback: "She suggested 2 o'clock (2時). Agree (いいよ！2時ね) or suggest another time (3時は？)." }, placeholder: "いいよ！2時ね" },
    },
    m3b: { id: "m3b", lines: [{ speaker: "mika", jp: "おっけー、3時にしよ！", en: "Okay, let's make it 3!" }], choices: [{ jp: "ありがと！", en: "Thanks!", tone: "natural", next: "m4" }] },
    m4: {
      id: "m4",
      lines: [{ speaker: "mika", jp: "駅の改札で待ち合わせしよ！", en: "Let's meet at the station ticket gates!", gloss: [{ t: "改札", r: "かいさつ", m: "ticket gates" }, { t: "待ち合わせ", r: "まちあわせ", m: "meeting up" }, { t: "しよ", m: "let's (casual しよう)" }] }],
      choices: [
        { jp: "了解！改札ね。", en: "Got it! The gates.", tone: "natural", next: "m5", objective: "place" },
        { jp: "どこの改札？", en: "Which gates?", tone: "natural", next: "m4b", feedback: "Good call. Big stations have many exits, so clarify." },
      ],
      typed: { rules: [{ patterns: ["了解", "りょうかい", "おけ", "オッケー", "わかった", "分かった", "いいよ"], tone: "natural", next: "m5", objective: "place" }, { patterns: ["どこ", "何口", "なにぐち"], tone: "natural", next: "m4b" }], fallback: { next: "m4", feedback: "She suggested meeting at the ticket gates (改札). Agree: 了解！ or ask どこの改札？" }, placeholder: "了解！" },
    },
    m4b: {
      id: "m4b",
      lines: [{ speaker: "mika", jp: "南口の改札！", en: "The south exit gates!", gloss: [{ t: "南口", r: "みなみぐち", m: "south exit" }] }],
      choices: [{ jp: "おけ！南口ね。", en: "OK! South exit.", tone: "natural", next: "m5", objective: "place" }],
    },
    m5: {
      id: "m5",
      lines: [{ speaker: "mika", jp: "楽しみ〜！🥳", en: "Can't wait!" }],
      choices: [
        { jp: "楽しみ！じゃあ、またね！", en: "Can't wait! See you then!", tone: "natural", next: "end", objective: "confirm", rel: { mika: 1 } },
        { jp: "（スタンプ：OK！）", en: "(Send an 'OK!' sticker.)", tone: "natural", next: "end", objective: "confirm", feedback: "Stickers are a totally natural way to close a LINE chat." },
      ],
    },
    end: { id: "end", lines: [{ speaker: "narration", jp: "（予定がカレンダーに追加された）", en: "(The plan was added to your calendar.)" }], end: { success: true } },
  },
};

export const QUESTS: QuestDef[] = [konbini, harutoInvite, mikaPlans];
export const questById = (id: string) => QUESTS.find((q) => q.id === id);
