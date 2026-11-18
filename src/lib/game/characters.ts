export interface CharacterProfile {
  id: string;
  name: string;
  nameJp: string;
  bio: string;
  style: string;
  interests: string[];
  color: string;
  hair: string;
  unlocked: boolean;
}

export const CHARACTERS: CharacterProfile[] = [
  {
    id: "haruto", name: "Haruto", nameJp: "ハルト", color: "#4da3ff", hair: "#2b2f3a", unlocked: true,
    bio: "Your gaming buddy from down the street. Loud on voice chat, secretly terrified of horror games.",
    style: "Very casual: 俺, slang (ガチ, 草, ｗ), short messages, lots of reactions.",
    interests: ["horror games", "FPS", "ramen", "streaming"],
  },
  {
    id: "mika", name: "Mika", nameJp: "ミカ", color: "#ff7aa8", hair: "#6b3b2a", unlocked: true,
    bio: "Sociable and expressive. Always finding new cafés and dragging friends along.",
    style: "Friendly casual: emoji, 〜しよ！, ねえねえ, elongated vowels (楽しみ〜).",
    interests: ["cafés", "fashion", "karaoke", "photos"],
  },
  {
    id: "ren", name: "Ren", nameJp: "レン", color: "#3dd68c", hair: "#1e3a2f", unlocked: false,
    bio: "Engineering student who loves talking tech and big ideas. Joins in a later chapter.",
    style: "Polite-casual mix, technical vocabulary, asks 'why?' a lot.",
    interests: ["robotics", "AI", "physics", "sci-fi"],
  },
];

export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id);
