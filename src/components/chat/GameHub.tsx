import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Gamepad2, Loader2, Swords, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyPartner } from "@/lib/push.functions";

type GameType = "tic-tac-toe" | "connect-four" | "rock-paper-scissors" | "word-scramble" | "quick-quiz";
type GameState = {
  board: any;
  turnId: string;
  round: number;
  choices: Record<string, string>;
  scores: Record<string, number>;
  answers: Record<string, boolean>;
  word: string;
  scrambled: string;
  question: number;
  winner?: string | null;
};
type Challenge = {
  id: string; game_type: GameType; challenger_id: string; opponent_id: string | null;
  status: "pending" | "active" | "completed" | "declined"; state: GameState;
  winner_id: string | null; created_at: string;
};
const GAMES: { id: GameType; name: string; detail: string; icon: string }[] = [
  { id: "tic-tac-toe", name: "Tic-tac-toe", detail: "A classic quick match for two or a solo warm-up.", icon: "⭕" },
  { id: "connect-four", name: "Four in a Row", detail: "Connect four before the other player.", icon: "🔴" },
  { id: "rock-paper-scissors", name: "Rock Paper Scissors", detail: "A little luck, a little strategy.", icon: "✊" },
  { id: "word-scramble", name: "Word Scramble", detail: "Unscramble the word and see who solves it first.", icon: "🔤" },
  { id: "quick-quiz", name: "Family Quiz", detail: "Fun general-knowledge questions.", icon: "🧠" },
];
const WORDS = ["SUNSHINE", "ELEPHANT", "RAINBOW", "POPCORN", "BUTTERFLY", "CHOCOLATE", "ADVENTURE"];
const QUIZ = [
  { q: "Which animal is known as the king of the jungle?", a: ["Lion", "Elephant", "Giraffe"], correct: 0 },
  { q: "How many colours are in a rainbow?", a: ["Five", "Seven", "Ten"], correct: 1 },
  { q: "Which planet do we live on?", a: ["Mars", "Venus", "Earth"], correct: 2 },
  { q: "What do bees make?", a: ["Milk", "Honey", "Bread"], correct: 1 },
  { q: "Which ocean is the largest?", a: ["Pacific", "Atlantic", "Indian"], correct: 0 },
];
const initialState = (game: GameType, first: string): GameState => ({
  board: game === "tic-tac-toe" ? Array(9).fill("") : game === "connect-four" ? Array.from({ length: 6 }, () => Array(7).fill("")) : [],
  turnId: first, round: 0, choices: {}, scores: {}, answers: {}, word: WORDS[0] ?? "SUNSHINE", scrambled: "HNSIUNES",
  question: 0, winner: null,
});
const winnerTtt = (b: string[]) => {
  const lines: [number, number, number][] = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, c, d] of lines) {
    const mark = b[a];
    if (mark && mark === b[c] && mark === b[d]) return mark;
  }
  return b.every(Boolean) ? "draw" : null;
};
const winnerConnect = (b: string[][]) => {
  for (let r=0;r<6;r++) for(let c=0;c<7;c++) {
    const p=b[r]?.[c]; if(!p) continue;
    const directions: [number, number][] = [[0,1],[1,0],[1,1],[1,-1]];
    for(const [dr,dc] of directions) {
      let ok=true; for(let k=1;k<4;k++){const rr=r+dr*k,cc=c+dc*k;if(rr<0||rr>=6||cc<0||cc>=7||b[rr]?.[cc]!==p){ok=false;break;}}
      if(ok) return p;
    }
  }
  return b.every(row=>row.every(Boolean)) ? "draw" : null;
};

export function GameHub({ userId, partnerName, onClose }: { userId: string; partnerName: string; onClose: () => void }) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selected, setSelected] = useState<GameType | null>(null);
  const [active, setActive] = useState<Challenge | null>(null);
  const [solo, setSolo] = useState(false);
  const [soloState, setSoloState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [answer, setAnswer] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("game_challenges").select("*").order("created_at", { ascending: false }).limit(30);
    if (!error) {
      const rows = (data ?? []) as Challenge[];
      setChallenges(rows);
      setActive((current) => current ? rows.find((row) => row.id === current.id) ?? current : null);
    }
  }, []);
  useEffect(() => { void load(); const ch = supabase.channel("popotso-games").on("postgres_changes", { event: "*", schema: "public", table: "game_challenges" }, () => void load()).subscribe(); return () => { void supabase.removeChannel(ch); }; }, [load]);

  const createChallenge = async (game: GameType) => {
    setBusy(true); setNotice("");
    const { data, error } = await (supabase as any).from("game_challenges").insert({
      game_type: game, challenger_id: userId, status: "pending", state: initialState(game, userId),
    }).select("*").single();
    setBusy(false);
    if (error) { setNotice("Couldn't send the challenge. Please try again."); return; }
    setSelected(game);
    void notifyPartner({ data: { preview: `🎮 You're challenged to ${GAMES.find(g=>g.id===game)?.name ?? "a game"}! Tap Popotso Games to join.`, title: "Popotso Games", type: "game", challengeId: data.id } }).catch(()=>{});
    setNotice(`Challenge sent to ${partnerName}. They'll see a Ready to join button.`);
    setActive(data as Challenge);
    await load();
  };
  const accept = async (challenge: Challenge) => {
    setBusy(true);
    const { data, error } = await (supabase as any).from("game_challenges").update({
      opponent_id: userId, status: "active",
    }).eq("id", challenge.id).eq("status", "pending").select("*").single();
    setBusy(false);
    if (error) { setNotice("That challenge is no longer available."); await load(); return; }
    setActive(data as Challenge); setSelected(challenge.game_type); setSolo(false);
  };
  const updateGame = async (next: GameState, winnerId?: string | null) => {
    if (!active) return;
    const { data, error } = await (supabase as any).from("game_challenges").update({
      state: next, status: next.winner ? "completed" : "active", winner_id: winnerId ?? null, updated_at: new Date().toISOString(),
    }).eq("id", active.id).select("*").single();
    if (!error) { setActive(data as Challenge); void load(); }
  };
  const startSolo = (game: GameType) => { setSelected(game); setSolo(true); setActive(null); setSoloState(initialState(game, userId)); setNotice(""); };
  const current: GameState | null = active?.state ?? soloState;
  const game = selected;
  const isMyTurn = !active || !active.opponent_id || current?.turnId === userId;
  const playerMark = active ? (active.challenger_id === userId ? "X" : "O") : "X";

  const playTtt = async (index: number) => {
    if (!current || current.board[index] || winnerTtt(current.board) || !isMyTurn) return;
    const mark = active ? playerMark : "X";
    const board = [...current.board]; board[index] = mark;
    let winner = winnerTtt(board);
    let next = { ...current, board, turnId: active ? (userId === active.challenger_id ? (active.opponent_id ?? userId) : active.challenger_id) : "ai" };
    if (!active && !winner && board.some((v:string)=>!v)) {
      const empty = board.map((v:string,i:number)=>v ? -1 : i).filter((v:number)=>v>=0);
      const ai = empty[Math.floor(Math.random()*empty.length)]; if (ai !== undefined) board[ai] = "O"; winner = winnerTtt(board);
      next = { ...next, board, turnId: userId };
    }
    if (winner) next = { ...next, winner };
    if (active) await updateGame(next, winner ? (winner === "draw" ? null : winner === "X" ? active.challenger_id : active.opponent_id) : undefined);
    else setSoloState(next);
  };
  const playConnect = async (col: number) => {
    if (!current || winnerConnect(current.board) || !isMyTurn) return;
    const board = current.board.map((r:string[])=>[...r]);
    let row = -1; for(let r=5;r>=0;r--) if(!board[r]?.[col]) { row=r; break; } if(row<0) return;
    const mark = active ? playerMark : "X"; board[row]![col]=mark;
    let winner = winnerConnect(board);
    let next = { ...current, board, turnId: active ? (userId===active.challenger_id?(active.opponent_id ?? userId):active.challenger_id) : "ai" };
    if(!active && !winner) { const choices=(board[0] ?? []).map((v:string,i:number)=>v? -1:i).filter((v:number)=>v>=0); if(choices.length){const c=choices[Math.floor(Math.random()*choices.length)] ?? -1;for(let r=5;r>=0;r--)if(c>=0 && !board[r]?.[c]){board[r]![c]="O";break;} winner=winnerConnect(board);} next={...next,board,turnId:userId}; }
    if(winner) next={...next,winner};
    if(active) await updateGame(next,winner?(winner==="draw"?null:winner==="X"?active.challenger_id:active.opponent_id):undefined); else setSoloState(next);
  };
  const chooseRps = async (choice: string) => {
    if (!current || current.choices?.[userId] || (active && !isMyTurn)) return;
    const choices = { ...(current.choices ?? {}), [userId]: choice };
    let winnerId: string | null | undefined;
    let winner = "";
    let turnId = current.turnId;

    if (active?.opponent_id && choices[active.challenger_id] && choices[active.opponent_id]) {
      const a = choices[active.challenger_id];
      const b = choices[active.opponent_id];
      winner = a === b ? "draw" :
        (a === "rock" && b === "scissors") ||
        (a === "paper" && b === "rock") ||
        (a === "scissors" && b === "paper") ? "X" : "O";
      winnerId = winner === "draw" ? null : winner === "X" ? active.challenger_id : active.opponent_id;
    } else if (active?.opponent_id) {
      turnId = active.opponent_id;
    } else if (!active) {
      choices["ai"] = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)] ?? "rock";
      const a = choices[userId];
      const b = choices["ai"];
      winner = a === b ? "draw" :
        (a === "rock" && b === "scissors") ||
        (a === "paper" && b === "rock") ||
        (a === "scissors" && b === "paper") ? "You win!" : "Computer wins";
    }

    const next = { ...current, choices, winner, turnId };
    if (active) await updateGame(next, winnerId);
    else setSoloState(next);
  };
  const submitWord = async () => {
    if(!current || (active && userId === active.challenger_id) || answer.trim().toUpperCase()!==current.word) { setNotice("Not quite — try again!"); return; }
    const next={...current,winner:"Correct! 🎉"};
    if(active) await updateGame(next,userId); else setSoloState(next);
    setAnswer("");
  };
  const submitQuiz = async (index: number) => {
    if(!current || current.answers?.[userId]!==undefined || (active && !isMyTurn)) return;
    const q=QUIZ[current.question%QUIZ.length]!; const answers={...(current.answers??{}),[userId]:index===q.correct};
    const next={...current,answers,turnId: active?.opponent_id ?? current.turnId};
    if(active?.opponent_id && answers[active.challenger_id]!==undefined && answers[active.opponent_id]!==undefined) {
      const a=answers[active.challenger_id],b=answers[active.opponent_id];
      const winnerId=a===b?null:a?active.challenger_id:active.opponent_id;
      await updateGame({...next,winner:a===b?"Draw":a?"Challenger wins":"Opponent wins"},winnerId);
    } else if(active?.opponent_id) { await updateGame({...next,turnId:active.opponent_id});
    } else if(!active) { const ai=Math.random()<.65; const winner=answers[userId]===ai?"Draw":answers[userId]?"You win!":"Computer wins"; setSoloState({...next,winner}); }
    else await updateGame(next);
  };

  const reset = async () => {
    if(!game) return;
    const next=initialState(game,active?.challenger_id??userId);
    if(active) await updateGame(next,null); else setSoloState(next);
    setNotice("");
  };
  const title = GAMES.find(g=>g.id===game)?.name ?? "Game";
  const waiting = active?.status==="pending" && active.challenger_id===userId;
  const incoming = challenges.filter(c=>c.status==="pending" && c.challenger_id!==userId);
  const myOpen = challenges.filter(c=>c.challenger_id===userId && c.status==="pending");
  const ongoing = challenges.find(c=>c.status==="active" && (c.challenger_id===userId || c.opponent_id===userId));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <button onClick={()=>{setSelected(null);setActive(null);setSolo(false);onClose();}} className="rounded-full p-2 hover:bg-secondary" aria-label="Back"><ArrowLeft className="size-5"/></button>
        <Gamepad2 className="size-5 text-primary"/><h2 className="font-semibold">Popotso Playtime</h2>
      </header>
      {!game ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 rounded-2xl bg-primary/10 p-4"><p className="font-semibold">A little friendly competition 💛</p><p className="mt-1 text-sm text-muted-foreground">Play together when you're both online, or enjoy a solo game whenever you like.</p></div>
          {notice && <p className="mb-3 rounded-xl bg-secondary p-3 text-sm">{notice}</p>}
          {incoming.length>0 && <section className="mb-5"><h3 className="mb-2 flex items-center gap-2 font-semibold"><Swords className="size-4"/> Challenges for you</h3>{incoming.map(c=><div key={c.id} className="mb-2 flex items-center justify-between rounded-xl border border-border p-3"><div><p className="font-medium">{GAMES.find(g=>g.id===c.game_type)?.name}</p><p className="text-xs text-muted-foreground">Someone challenged you</p></div><button disabled={busy} onClick={()=>void accept(c)} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Ready to join</button></div>)}</section>}
          {myOpen.length>0 && <p className="mb-3 text-xs text-muted-foreground">Waiting for {partnerName} to accept your challenge…</p>}
          {ongoing && <div className="mb-4 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3"><div><p className="font-semibold">Game in progress</p><p className="text-xs text-muted-foreground">{GAMES.find(g=>g.id===ongoing.game_type)?.name}</p></div><button onClick={()=>{setActive(ongoing);setSelected(ongoing.game_type);setSolo(false);}} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Resume game</button></div>}
          <div className="grid gap-3 sm:grid-cols-2">{GAMES.map(g=><article key={g.id} className="rounded-2xl border border-border p-4"><div className="text-3xl">{g.icon}</div><h3 className="mt-2 font-semibold">{g.name}</h3><p className="mt-1 min-h-9 text-xs text-muted-foreground">{g.detail}</p><div className="mt-3 flex gap-2"><button disabled={busy} onClick={()=>void createChallenge(g.id)} className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Challenge {partnerName}</button><button onClick={()=>startSolo(g.id)} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold">Solo</button></div></article>)}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-md">
            <div className="mb-4 flex items-center justify-between"><button onClick={()=>{setSelected(null);setActive(null);setSolo(false);}} className="text-sm text-primary">← All games</button><span className="text-xs text-muted-foreground">{solo?"Single player":active?.status==="pending"?"Challenge sent":"Two player"}</span></div>
            <h3 className="mb-2 text-center text-xl font-bold">{title}</h3>
            {waiting && <div className="rounded-2xl bg-secondary p-4 text-center"><Loader2 className="mx-auto mb-2 size-6 animate-spin"/><p className="font-semibold">Challenge sent!</p><p className="text-sm text-muted-foreground">Waiting for {partnerName} to join.</p></div>}
            {active?.status==="active" && <p className="mb-3 text-center text-sm text-muted-foreground">{isMyTurn?"Your turn!":"Waiting for the other player…"}</p>}
            {game==="tic-tac-toe" && <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-2">{(current?.board??[]).map((v:string,i:number)=><button key={i} disabled={!isMyTurn||Boolean(v)||Boolean(current?.winner)||waiting} onClick={()=>void playTtt(i)} className="aspect-square rounded-2xl border border-border bg-card text-4xl font-bold">{v}</button>)}</div>}
            {game==="connect-four" && <div className="mx-auto grid max-w-[340px] grid-cols-7 gap-1 rounded-2xl bg-blue-600 p-2">{(current?.board??[]).flatMap((row:string[],r:number)=>row.map((v:string,c:number)=><button key={r+"-"+c} onClick={()=>void playConnect(c)} disabled={!isMyTurn||Boolean(current?.winner)||waiting} className={`aspect-square rounded-full border border-blue-800 ${v==="X"?"bg-red-400":v==="O"?"bg-yellow-300":"bg-white"}`}/>))}</div>}
            {game==="rock-paper-scissors" && <div className="flex justify-center gap-3">{([["rock","✊"],["paper","✋"],["scissors","✌️"]] as [string, string][]).map(([v,e])=><button key={v} onClick={()=>void chooseRps(v)} disabled={Boolean(current?.choices?.[userId])||waiting||!isMyTurn} className="rounded-2xl border border-border p-4 text-3xl">{e}</button>)}</div>}
            {game==="word-scramble" && <div className="rounded-2xl border border-border p-5 text-center"><p className="text-xs text-muted-foreground">Unscramble this word</p><p className="my-4 text-2xl font-black tracking-[0.3em]">{current?.scrambled??"HNSIUNES"}</p><input value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Your answer" className="w-full rounded-xl border border-border bg-card p-3 text-center uppercase"/><button disabled={waiting || Boolean(active && userId === active.challenger_id) || Boolean(current?.winner)} onClick={()=>void submitWord()} className="mt-3 w-full rounded-xl bg-primary p-3 text-sm font-semibold text-primary-foreground">Check answer</button></div>}
            {game==="quick-quiz" && <div className="rounded-2xl border border-border p-4"><p className="font-semibold">{QUIZ[(current?.question??0)%QUIZ.length]!.q}</p><div className="mt-3 grid gap-2">{QUIZ[(current?.question??0)%QUIZ.length]!.a.map((a,i)=><button key={a} onClick={()=>void submitQuiz(i)} disabled={waiting||current?.answers?.[userId]!==undefined||!isMyTurn} className="rounded-xl border border-border p-3 text-left text-sm">{a}</button>)}</div></div>}
            {current?.winner && <div className="mt-4 rounded-2xl bg-primary/10 p-4 text-center"><Trophy className="mx-auto mb-1 size-6 text-primary"/><p className="font-bold">{current.winner==="draw"?"It's a draw!":current.winner==="X"?"X wins!":current.winner==="O"?"O wins!":current.winner}</p></div>}
            {notice && <p className="mt-3 text-center text-sm text-muted-foreground">{notice}</p>}
            <div className="mt-5 flex gap-2"><button onClick={()=>void reset()} className="flex-1 rounded-xl border border-border p-3 text-sm font-semibold">Play again</button><button onClick={()=>{setSelected(null);setActive(null);setSolo(false);}} className="flex-1 rounded-xl bg-secondary p-3 text-sm font-semibold">Choose another</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
