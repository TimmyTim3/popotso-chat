import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Gamepad2, Loader2, Swords, Trophy, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyPartner } from "@/lib/push.functions";
import { rollFairDie, shouldRollAgain, resolveLadderCollision } from "@/lib/snakes-ladders";

type GameType = "tic-tac-toe" | "connect-four" | "rock-paper-scissors" | "word-scramble" | "quick-quiz" | "snake" | "snakes-ladders" | "draughts";
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
  questionPool?: number[];
  streak?: number;
  lastCorrect?: boolean | undefined;
  winnerLine?: number[];
  snakeDirection?: "up" | "down" | "left" | "right";
  snakeNextDirection?: "up" | "down" | "left" | "right";
  forcedPiece?: number | null;
  computerTakeoverBy?: string | null;
  computerTakeoverAt?: string | null;
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
  { id: "snake", name: "Snake", detail: "Guide the snake, eat the fruit and beat your best score. Solo game.", icon: "🐍" },
  { id: "snakes-ladders", name: "Snakes & Ladders", detail: "Roll the dice, climb ladders and avoid the snakes.", icon: "🎲" },
  { id: "draughts", name: "Draughts / Checkers", detail: "Jump your opponent, crown kings and capture every piece.", icon: "♟️" },
];
const WORDS = ["SUNSHINE", "ELEPHANT", "RAINBOW", "POPCORN", "BUTTERFLY", "CHOCOLATE", "ADVENTURE"];
const QUIZ = [
  { q: "Which animal is known as the king of the jungle?", a: ["Lion", "Elephant", "Giraffe"], correct: 0 },
  { q: "How many colours are in a rainbow?", a: ["Five", "Seven", "Ten"], correct: 1 },
  { q: "Which planet do we live on?", a: ["Mars", "Venus", "Earth"], correct: 2 },
  { q: "What do bees make?", a: ["Milk", "Honey", "Bread"], correct: 1 },
  { q: "Which ocean is the largest?", a: ["Pacific", "Atlantic", "Indian"], correct: 0 },
  { q: "What is the capital city of South Africa?", a: ["Pretoria", "Durban", "Polokwane"], correct: 0 },
  { q: "Which animal is the tallest in the world?", a: ["Elephant", "Giraffe", "Ostrich"], correct: 1 },
  { q: "What is the biggest land animal?", a: ["African elephant", "Rhino", "Hippo"], correct: 0 },
  { q: "Which bird is famous for not being able to fly?", a: ["Eagle", "Penguin", "Swallow"], correct: 1 },
  { q: "What do caterpillars turn into?", a: ["Bees", "Butterflies", "Spiders"], correct: 1 },
  { q: "How many legs does a spider have?", a: ["Six", "Eight", "Ten"], correct: 1 },
  { q: "Which planet is called the Red Planet?", a: ["Mars", "Jupiter", "Saturn"], correct: 0 },
  { q: "What gas do plants take in from the air?", a: ["Oxygen", "Carbon dioxide", "Helium"], correct: 1 },
  { q: "How many sides does a triangle have?", a: ["Three", "Four", "Five"], correct: 0 },
  { q: "What is frozen water called?", a: ["Steam", "Ice", "Rain"], correct: 1 },
  { q: "Which animal has black and white stripes?", a: ["Zebra", "Cheetah", "Buffalo"], correct: 0 },
  { q: "Which South African animal is known for its horn?", a: ["Rhino", "Meerkat", "Springbok"], correct: 0 },
  { q: "What is South Africa's national flower?", a: ["Rose", "King Protea", "Sunflower"], correct: 1 },
  { q: "Which ocean borders Durban?", a: ["Atlantic", "Indian", "Pacific"], correct: 1 },
  { q: "What is the name of the famous South African flat-topped mountain?", a: ["Table Mountain", "Lion's Head", "Signal Hill"], correct: 0 },
  { q: "How many days are in a week?", a: ["Five", "Seven", "Nine"], correct: 1 },
  { q: "Which sense do we use with our ears?", a: ["Sight", "Hearing", "Taste"], correct: 1 },
  { q: "What is the closest star to Earth?", a: ["The Sun", "Sirius", "Polaris"], correct: 0 },
  { q: "Which animal hops and carries its baby in a pouch?", a: ["Kangaroo", "Monkey", "Fox"], correct: 0 },
  { q: "What do you call a baby dog?", a: ["Kitten", "Puppy", "Calf"], correct: 1 },
  { q: "How many minutes are in one hour?", a: ["30", "60", "100"], correct: 1 },
  { q: "Which part of a plant usually grows underground?", a: ["Flower", "Root", "Leaf"], correct: 1 },
  { q: "What is the largest mammal in the world?", a: ["Blue whale", "Giraffe", "Elephant"], correct: 0 },
  { q: "Which South African animal is famous for its fast running?", a: ["Springbok", "Tortoise", "Chameleon"], correct: 0 },
  { q: "What do we use to measure temperature?", a: ["Ruler", "Thermometer", "Compass"], correct: 1 },
  { q: "Which shape has four equal sides?", a: ["Circle", "Square", "Triangle"], correct: 1 },
  { q: "What is the natural home of a lion called?", a: ["Savanna", "Arctic", "Ocean"], correct: 0 },
];
const initialState = (game: GameType, first: string): GameState => ({
  board: game === "tic-tac-toe" ? Array(9).fill("") : game === "connect-four" ? Array.from({ length: 6 }, () => Array(7).fill("")) : game === "snake" ? { body: [[7, 7], [6, 7], [5, 7]], food: [10, 7], score: 0, over: false } : game === "snakes-ladders" ? { positions: { [first]: 0, ai: 0 }, dice: null } : game === "draughts" ? createDraughtsBoard() : [],
  turnId: first, round: 0, choices: {}, scores: {}, answers: {}, word: WORDS[0] ?? "SUNSHINE", scrambled: "HNSIUNES",
  question: 0, questionPool: [...QUIZ.keys()].sort(() => Math.random() - 0.5), streak: 0, winner: null,
  snakeDirection: "right", snakeNextDirection: "right",
});
type DraughtsMove = { from: number; to: number; capture: number | null };
type DraughtsAnimation = { from: number; to: number; piece: string; phase: "start" | "moving" };
const createDraughtsBoard = () => {
  const board=Array(64).fill("");
  for(let row=0;row<3;row++)for(let col=0;col<8;col++)if((row+col)%2===1)board[row*8+col]="b";
  for(let row=5;row<8;row++)for(let col=0;col<8;col++)if((row+col)%2===1)board[row*8+col]="r";
  return board;
};
const draughtsSide = (piece:string) => piece.toLowerCase();
const draughtsMovesForPiece = (board:string[],from:number):DraughtsMove[] => {
  const piece=board[from]; if(!piece) return [];
  const row=Math.floor(from/8),col=from%8,side=draughtsSide(piece),king=piece!==side;
  const directions=king?[-1,1]:side==="r"?[-1]:[1];
  const captures:DraughtsMove[]=[],steps:DraughtsMove[]=[];
  for(const dr of directions)for(const dc of [-1,1]){
    const r1=row+dr,c1=col+dc,r2=row+dr*2,c2=col+dc*2;
    if(r1<0||r1>7||c1<0||c1>7)continue;
    const adjacent=r1*8+c1;
    if(board[adjacent] && draughtsSide(board[adjacent])!==side && r2>=0&&r2<8&&c2>=0&&c2<8&&!board[r2*8+c2])
      captures.push({from,to:r2*8+c2,capture:adjacent});
    else if(!board[adjacent]) steps.push({from,to:adjacent,capture:null});
  }
  return [...captures,...steps];
};
const getDraughtsLegalMoves = (board:string[],side:string,forcedPiece:number|null=null):DraughtsMove[] => {
  // Draughts here allows a player to choose any of their pieces.
  // A capture by one piece must not globally block ordinary moves by another.
  // Only a multi-capture sequence forces the same piece to continue jumping.
  const pieces=forcedPiece!==null?[forcedPiece]:board.map((piece,index)=>piece&&draughtsSide(piece)===side?index:-1).filter(index=>index>=0);
  return pieces.flatMap(index=>draughtsMovesForPiece(board,index)).filter(move=>board[move.from]&&draughtsSide(board[move.from])===side);
};
const applyDraughtsMove = (board:string[],move:DraughtsMove) => {
  const next=[...board],piece=next[move.from];
  if(!piece || move.from<0 || move.from>=64 || move.to<0 || move.to>=64 || (move.capture!==null&&(move.capture<0||move.capture>=64))) return {board:[...board],forcedPiece:null};
  next[move.from]="";
  if(move.capture!==null) next[move.capture]="";
  next[move.to]=piece;
  const row=Math.floor(move.to/8);
  if(piece==="r"&&row===0)next[move.to]="R";
  if(piece==="b"&&row===7)next[move.to]="B";
  const promoted=next[move.to]!==piece;
  const followUps=move.capture!==null&&!promoted?draughtsMovesForPiece(next,move.to).filter(candidate=>candidate.capture!==null):[];
  return {board:next,forcedPiece:followUps.length?move.to:null};
};
const getDraughtsWinner = (board:string[]) => {
  const red=board.some(piece=>draughtsSide(piece)==="r"),black=board.some(piece=>draughtsSide(piece)==="b");
  if(!red)return "b"; if(!black)return "r";
  if(!getDraughtsLegalMoves(board,"r").length)return "b";
  if(!getDraughtsLegalMoves(board,"b").length)return "r";
  return null;
};
const TTT_LINES: [number, number, number][] = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const findTttWinningLine = (board: string[]) => TTT_LINES.find(([a,c,d]) => Boolean(board[a]) && board[a] === board[c] && board[a] === board[d]) ?? null;
const winnerTtt = (board: string[]) => {
  const line = findTttWinningLine(board);
  return line ? board[line[0]]! : board.every(Boolean) ? "draw" : null;
};
const findConnectWinningLine = (board: string[][]) => {
  for (let row=0; row<6; row++) for (let col=0; col<7; col++) {
    const mark=board[row]?.[col]; if(!mark) continue;
    for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]] as [number,number][]) {
      const cells: [number,number][] = [[row,col]];
      for(let step=1;step<4;step++) {
        const rr=row+dr*step, cc=col+dc*step;
        if(rr<0||rr>=6||cc<0||cc>=7||board[rr]?.[cc]!==mark) break;
        cells.push([rr,cc]);
      }
      if(cells.length===4) return cells;
    }
  }
  return null;
};
const winnerConnect = (board: string[][]) => {
  const line=findConnectWinningLine(board);
  return line ? board[line[0]![0]]![line[0]![1]]! : board.every(row=>row.every(Boolean)) ? "draw" : null;
};
const SNAKES_LADDERS: Record<number, number> = { 4:14, 9:31, 20:38, 28:84, 40:59, 63:81, 71:91, 17:7, 54:34, 62:19, 64:60, 87:24, 93:73, 95:75, 99:78 };
const advanceLadderBoard = (positions: Record<string, number>, player: string, dice: number) => {
  const current=positions[player] ?? 0;
  const landing=current+dice;
  const next=landing>100 ? current : (SNAKES_LADDERS[landing] ?? landing);
  return { ...positions, [player]: next };
};
const dropConnectDisc = (board: string[][], column: number, mark: string) => {
  const copy=board.map((row) => [...row]);
  for(let row=5;row>=0;row--) if(!copy[row]?.[column]) { copy[row]![column]=mark; return copy; }
  return null;
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
  const [thinking, setThinking] = useState(false);
  const [rpsCountdown, setRpsCountdown] = useState("");
  const [selectedDraughtsPiece, setSelectedDraughtsPiece] = useState<number|null>(null);
  const [ladderDiceRolling, setLadderDiceRolling] = useState(false);
  const [ladderDiceFace, setLadderDiceFace] = useState(1);
  const [ladderDiceRevealed, setLadderDiceRevealed] = useState(false);
  const [ladderVisualPositions, setLadderVisualPositions] = useState<Record<string, number> | null>(null);
  const [ladderMessage, setLadderMessage] = useState("");
  const [draughtsCaptureAt, setDraughtsCaptureAt] = useState<number|null>(null);
  const [draughtsAnimation, setDraughtsAnimation] = useState<DraughtsAnimation|null>(null);
  const [draughtsLastMove, setDraughtsLastMove] = useState<{from:number;to:number;capture:number|null}|null>(null);
  const [connectLastDrop, setConnectLastDrop] = useState<{row:number;col:number;mark:string}|null>(null);
  const [quizFeedback, setQuizFeedback] = useState<boolean|null>(null);
  const [gameMessages, setGameMessages] = useState<any[]>([]);
  const [gameMessageDraft, setGameMessageDraft] = useState("");
  const [sendingGameMessage, setSendingGameMessage] = useState(false);
  const gameMessagesEndRef = useRef<HTMLDivElement|null>(null);
  useEffect(() => {
    if(!draughtsLastMove) return;
    const timer=window.setTimeout(()=>{setDraughtsLastMove(null);setDraughtsCaptureAt(null);},1500);
    return ()=>window.clearTimeout(timer);
  },[draughtsLastMove]);
  const snakeTouchStart = useRef<{x:number;y:number}|null>(null);
  const snakeDirectionRef = useRef<"up" | "down" | "left" | "right">("right");

  useEffect(() => {
    if (!ladderDiceRolling) return;
    const timer = window.setInterval(() => setLadderDiceFace(rollFairDie()), 90);
    return () => window.clearInterval(timer);
  }, [ladderDiceRolling]);

  const setSnakeDirection = (direction: "up" | "down" | "left" | "right") => {
    const currentDirection=snakeDirectionRef.current;
    const reverse=(currentDirection==="up"&&direction==="down")||(currentDirection==="down"&&direction==="up")||(currentDirection==="left"&&direction==="right")||(currentDirection==="right"&&direction==="left");
    if(!reverse) snakeDirectionRef.current=direction;
  };
  useEffect(() => {
    if(selected!=="snake" || !solo) return;
    const onKey=(event:KeyboardEvent)=>{
      const map:Record<string,"up"|"down"|"left"|"right">={ArrowUp:"up",w:"up",ArrowDown:"down",s:"down",ArrowLeft:"left",a:"left",ArrowRight:"right",d:"right"};
      const direction=map[event.key];
      if(direction){event.preventDefault();setSnakeDirection(direction);}
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[selected,solo]);
  useEffect(() => {
    if(selected!=="snake" || !solo) return;
    const timer=window.setInterval(()=>{
      setSoloState((previous)=>{
        if(!previous||previous.winner)return previous;
        const board=previous.board as {body:number[][];food:number[];score:number;over:boolean};
        if(!board||board.over)return previous;
        const direction=snakeDirectionRef.current;
        const delta:Record<string,number[]>={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
        const vector=delta[direction]??[1,0];
        const head=board.body[0]??[7,7];
        const nextHead=[head[0]!+vector[0]!,head[1]!+vector[1]!];
        const ate=nextHead[0]===board.food[0]&&nextHead[1]===board.food[1];
        const bodyToCheck=ate?board.body:board.body.slice(0,-1);
        const hit=nextHead[0]!<0||nextHead[0]!>=16||nextHead[1]!<0||nextHead[1]!>=16||bodyToCheck.some(([x,y])=>x===nextHead[0]&&y===nextHead[1]);
        if(hit)return {...previous,board:{...board,over:true},winner:"Game over!"};
        const body=[nextHead,...(ate?board.body:board.body.slice(0,-1))];
        let food=board.food,score=board.score;
        if(ate){
          score+=10;
          const empty:number[][]=[];
          for(let y=0;y<16;y++)for(let x=0;x<16;x++)if(!body.some(([bx,by])=>bx===x&&by===y))empty.push([x,y]);
          food=empty[Math.floor(Math.random()*empty.length)]??[0,0];
        }
        return {...previous,board:{body,food,score,over:false},snakeDirection:direction};
      });
    },170);
    return ()=>window.clearInterval(timer);
  },[selected,solo]);

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
  const requestComputerTakeover = async () => {
    if (!active || active.status !== "active" || active.state.computerTakeoverBy) return;
    const next = { ...active.state, computerTakeoverBy: userId, computerTakeoverAt: new Date().toISOString() };
    const { data, error } = await (supabase as any).from("game_challenges").update({ state: next, updated_at: new Date().toISOString() }).eq("id", active.id).eq("status", "active").select("*").single();
    if (error) { setNotice("Couldn't hand over control. Please try again."); return; }
    setActive(data as Challenge);
    void notifyPartner({ data: { preview: "🤖 The computer has temporarily taken over their side of your game. They'll take back control when they return.", title: "Computer took over", type: "game", challengeId: active.id } }).catch(()=>{});
  };
  const takeBackControl = async () => {
    if (!active || active.state.computerTakeoverBy !== userId) return;
    const next = { ...active.state, computerTakeoverBy: null, computerTakeoverAt: null };
    const { data, error } = await (supabase as any).from("game_challenges").update({ state: next, updated_at: new Date().toISOString() }).eq("id", active.id).eq("status", "active").select("*").single();
    if (error) { setNotice("Couldn't reclaim control. Please try again."); return; }
    setActive(data as Challenge);
    const partnerId = userId === active.challenger_id ? active.opponent_id : active.challenger_id;
    if (partnerId) void notifyPartner({ data: { preview: "🙌 They're back and have taken control of their side again.", title: "Player returned", type: "game", challengeId: active.id } }).catch(()=>{});
  };
  // The online opponent's device acts as the temporary host while the absent player is away.
  // It persists each AI move to the shared challenge, so the absent player can safely return later.
  useEffect(() => {
    if (!active || active.status !== "active" || !active.opponent_id || !active.state.computerTakeoverBy || active.state.computerTakeoverBy === userId || active.state.turnId !== active.state.computerTakeoverBy || active.state.winner) return;
    const timer = window.setTimeout(async () => {
      const state = active.state;
      const missing = state.computerTakeoverBy!;
      const mark = missing === active.challenger_id ? "X" : "O";
      let next: GameState = { ...state };
      let winner: string | null = null;
      if (active.game_type === "tic-tac-toe") {
        const board = [...(state.board as string[])];
        const lines: [number,number,number][] = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        const pick = lines.find(line=>line.every(i=>board[i]===mark))?.find(i=>!board[i]) ?? lines.find(line=>line.every(i=>board[i]!== (mark==="X"?"O":"X"))&&line.some(i=>!board[i]))?.find(i=>!board[i]) ?? (board[4] ? board.findIndex(v=>!v) : 4);
        if (pick>=0) board[pick]=mark;
        winner=winnerTtt(board);
        next={...state,board,turnId:missing===active.challenger_id?active.opponent_id!:active.challenger_id,winner:winner??null,winnerLine:findTttWinningLine(board)??undefined};
      } else if (active.game_type === "connect-four") {
        const board=(state.board as string[][]).map(row=>[...row]);
        const legal=board[0]!.map((v,i)=>v?-1:i).filter(i=>i>=0);
        const wins=(m:string)=>legal.find(col=>{const b=dropConnectDisc(board,col,m);return !!b&&winnerConnect(b)===m;});
        const col=wins(mark)??wins(mark==="X"?"O":"X")??legal.sort((a,b)=>Math.abs(a-3)-Math.abs(b-3))[0];
        if(col!==undefined){const b=dropConnectDisc(board,col,mark);if(b)board.splice(0,6,...b);}
        winner=winnerConnect(board);
        next={...state,board,turnId:missing===active.challenger_id?active.opponent_id!:active.challenger_id,winner:winner??null,winnerLine:findConnectWinningLine(board)?.flatMap(([row,col])=>[row*7+col])};
      } else if (active.game_type === "draughts") {
        let board=[...(state.board as string[])], forced=state.forcedPiece??null, side=mark==="X"?"r":"b";
        const moves=getDraughtsLegalMoves(board,side,forced);
        if(moves.length){const captures=moves.filter(m=>m.capture!==null);const move=(captures.length?captures:moves)[Math.floor(Math.random()*(captures.length?captures.length:moves.length))]!;const applied=applyDraughtsMove(board,move);board=applied.board;forced=applied.forcedPiece;}
        winner=getDraughtsWinner(board);
        const sameTurn=forced!==null;
        next={...state,board,forcedPiece:forced,turnId:sameTurn?missing:(missing===active.challenger_id?active.opponent_id!:active.challenger_id),winner:winner?(winner==="r"?"Red wins!":"Black wins!"):null};
      } else if (active.game_type === "rock-paper-scissors") {
        const choices={...(state.choices??{}),[missing]:["rock","paper","scissors"][Math.floor(Math.random()*3)]!};
        const other=missing===active.challenger_id?active.opponent_id!:active.challenger_id;
        if(choices[other]){const a=choices[active.challenger_id],b=choices[active.opponent_id!];winner=a===b?"draw":((a==="rock"&&b==="scissors")||(a==="paper"&&b==="rock")||(a==="scissors"&&b==="paper"))?"X":"O";}
        next={...state,choices,turnId:missing===active.challenger_id?active.opponent_id!:active.challenger_id,winner:winner??null};
      } else if (active.game_type === "word-scramble") {
        next={...state,winner:"Computer solved it! 🤖",turnId:missing};
        winner="Computer solved it! 🤖";
      } else if (active.game_type === "quick-quiz") {
        const pool=state.questionPool?.length?state.questionPool:[...QUIZ.keys()];
        const q=QUIZ[pool[state.question%pool.length]??0]!;
        const answers={...(state.answers??{}),[missing]:Math.random()<0.65};
        const other=missing===active.challenger_id?active.opponent_id!:active.challenger_id;
        if(answers[other]!==undefined){const scores={...(state.scores??{}),[missing]:(state.scores?.[missing]??0)+(answers[missing]?1:0),[other]:(state.scores?.[other]??0)+(answers[other]?1:0)};next={...state,answers:{},scores,question:state.question+1,turnId:other};}
        else next={...state,answers,turnId:other};
      } else if (active.game_type === "snakes-ladders") {
        const positions={...((state.board as any)?.positions??{})};
        const dice=rollFairDie();const start=positions[missing]??0;const landing=start+dice;
        const destination=landing>100?start:(SNAKES_LADDERS[landing]??landing);
        const collision=resolveLadderCollision(positions,missing,destination);
        Object.assign(positions,collision.positions);
        winner=positions[missing]===100?"Computer reached 100! 🤖":null;
        next={...state,board:{...state.board,positions,dice},turnId:winner?missing:(dice===6?missing:(missing===active.challenger_id?active.opponent_id!:active.challenger_id)),winner};
      } else return;
      const winnerId=winner?(winner==="draw"?null:(winner==="X"?active.challenger_id:winner==="O"?active.opponent_id:missing)):null;
      await (supabase as any).from("game_challenges").update({state:next,status:winner?"completed":"active",winner_id:winnerId,updated_at:new Date().toISOString()}).eq("id",active.id).eq("updated_at",active.updated_at);
      void load();
    }, 1100);
    return ()=>window.clearTimeout(timer);
  }, [active?.id,active?.updated_at,active?.state,active?.status,userId,load]);

  const updateGame = async (next: GameState, winnerId?: string | null) => {
    if (!active) return;
    const { data, error } = await (supabase as any).from("game_challenges").update({
      state: next, status: next.winner ? "completed" : "active", winner_id: winnerId ?? null, updated_at: new Date().toISOString(),
    }).eq("id", active.id).select("*").single();
    if (!error) { setActive(data as Challenge); void load(); }
  };
  const startSolo = (game: GameType) => { setLadderVisualPositions(null);setLadderMessage("");setDraughtsCaptureAt(null);setDraughtsAnimation(null);setDraughtsLastMove(null);setQuizFeedback(null);snakeDirectionRef.current="right"; setSelectedDraughtsPiece(null); setSelected(game); setSolo(true); setActive(null); setSoloState(initialState(game, userId)); setNotice(""); };
  useEffect(() => {
    if (!active?.id) { setGameMessages([]); return; }
    let alive = true;
    const fetchMessages = async () => {
      const { data, error } = await (supabase as any).from("game_messages").select("id,challenge_id,sender_id,message,created_at").eq("challenge_id", active.id).order("created_at", { ascending: true }).limit(100);
      if (!error && alive) setGameMessages(data ?? []);
    };
    void fetchMessages();
    const channel = supabase.channel("game-messages-" + active.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_messages", filter: "challenge_id=eq." + active.id }, () => void fetchMessages())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [active?.id]);
  useEffect(() => { gameMessagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [gameMessages]);
  const sendGameMessage = async () => {
    const message = gameMessageDraft.trim();
    if (!active || !message || sendingGameMessage || message.length > 500) return;
    setSendingGameMessage(true);
    const { error } = await (supabase as any).from("game_messages").insert({ challenge_id: active.id, sender_id: userId, message });
    setSendingGameMessage(false);
    if (error) { setNotice("Message couldn't be sent. Please try again."); return; }
    setGameMessageDraft("");
  };

  const current: GameState | null = active?.state ?? soloState;
  const game = selected;
  const isMyTurn = !active || !active.opponent_id || current?.turnId === userId;
  const playerMark = active ? (active.challenger_id === userId ? "X" : "O") : "X";

  const playTtt = async (index: number) => {
    if (!current || current.board[index] || winnerTtt(current.board) || !isMyTurn) return;
    const mark = active ? playerMark : "X";
    const board = [...current.board]; board[index] = mark;
    let winner = winnerTtt(board);
    let winnerLine = findTttWinningLine(board) ?? undefined;
    let next = { ...current, board, turnId: active ? (userId === active.challenger_id ? (active.opponent_id ?? userId) : active.challenger_id) : "ai" };
    if (!active && !winner && board.some((v:string)=>!v)) {
      setThinking(true);
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      const lines: [number,number,number][] = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      const findMove = (mark:string) => lines.find((line) => line.filter((i) => board[i] === mark).length === 2 && line.some((i) => !board[i]))?.find((i) => !board[i]);
      const ai = findMove("O") ?? findMove("X") ?? (!board[4] ? 4 : [0,2,6,8].find((i) => !board[i]) ?? board.findIndex((v:string)=>!v));
      if (ai >= 0) board[ai] = "O";
      winner = winnerTtt(board);
      winnerLine = findTttWinningLine(board) ?? undefined;
      next = { ...next, board, turnId: userId };
      setThinking(false);
    }
    if (winner) next = { ...next, winner, winnerLine };
    if (active) await updateGame(next, winner ? (winner === "draw" ? null : wi  const playConnect = async (col: number) => {
    if (!current || current.winner || winnerConnect(current.board) || !isMyTurn || thinking || busy || waiting) return;
    const board = dropConnectDisc(current.board, col, active ? playerMark : "X");
    if (!board) return;
    const playerMarkForDrop = active ? playerMark : "X";
    const playerRow = board.findIndex((row:string[], index:number) => row[col] !== (current.board as string[][])[index]?.[col]);
    setConnectLastDrop({ row: playerRow, col, mark: playerMarkForDrop });
    let winner = winnerConnect(board);
    let winnerLine = findConnectWinningLine(board)?.map(([row,col])=>row*7+col) ?? undefined;
    let next: GameState = { ...current, board, turnId: active ? (userId===active.challenger_id?(active.opponent_id ?? userId):active.challenger_id) : "ai", winner: winner ?? null, winnerLine };
    if (active) {
      await updateGame(next, winner ? (winner==="draw" ? null : winner==="X" ? active.challenger_id : active.opponent_id) : undefined);
      return;
    }
    // Render the player's disc immediately, then give the computer a full three-second turn pause.
    setSoloState(next);
    if (winner) return;
    setThinking(true);
    await new Promise(resolve => window.setTimeout(resolve, 3000));
    const legal = (board[0] ?? []).map((v:string,i:number)=>v ? -1 : i).filter((v:number)=>v>=0);
    const wins = (mark:string) => legal.find((column:number) => {
      const trial=dropConnectDisc(board,column,mark);
      return trial ? winnerConnect(trial)===mark : false;
    });
    const chosen = wins("O") ?? wins("X") ?? [...legal].sort((a:number,b:number)=>Math.abs(a-3)-Math.abs(b-3))[0];
    if (chosen !== undefined) {
      const aiBoard=dropConnectDisc(board,chosen,"O");
      if(aiBoard) {
        const aiRow=aiBoard.findIndex((row:string[],index:number)=>row[chosen]!==board[index]?.[chosen]);
        setConnectLastDrop({row:aiRow,col:chosen,mark:"O"});
        const aiWinner=winnerConnect(aiBoard);
        const aiLine=findConnectWinningLine(aiBoard)?.map(([row,col])=>row*7+col) ?? undefined;
        next={...next,board:aiBoard,turnId:userId,winner:aiWinner??null,winnerLine:aiLine};
        setSoloState(next);
        await new Promise(resolve=>window.setTimeout(resolve,750));
      }
    }
    setThinking(false);
  };
raw"?null:winner==="X"?active.challenger_id:active.opponent_id):undefined); else setSoloState(next);
  };
  const playDraughts = async (square:number) => {
    if(!current || current.winner || thinking || waiting || busy || draughtsAnimation || !isMyTurn) return;
    const side=solo?(current.turnId==="ai"?"b":"r"):(active?.challenger_id===userId?"r":"b");
    const board=[...(current.board as string[])];
    const forced=current.forcedPiece??null;
    const legal=getDraughtsLegalMoves(board,side,forced);
    if(selectedDraughtsPiece===null){
      if(board[square]&&draughtsSide(board[square]!)===side&&legal.some(move=>move.from===square)) setSelectedDraughtsPiece(square);
      return;
    }
    if(board[square]&&draughtsSide(board[square]!)===side){
      if(legal.some(move=>move.from===square)) setSelectedDraughtsPiece(square);
      return;
    }
    const move=legal.find(candidate=>candidate.from===selectedDraughtsPiece&&candidate.to===square);
    if(!move){setSelectedDraughtsPiece(null);return;}
    const animateMove=async (moveToAnimate:DraughtsMove,piece:string) => {
      setDraughtsAnimation({from:moveToAnimate.from,to:moveToAnimate.to,piece,phase:"start"});
      await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
      setDraughtsAnimation({from:moveToAnimate.from,to:moveToAnimate.to,piece,phase:"moving"});
      await new Promise(resolve=>window.setTimeout(resolve,1400));
      setDraughtsAnimation(null);
      setDraughtsLastMove({from:moveToAnimate.from,to:moveToAnimate.to,capture:moveToAnimate.capture});
      if(moveToAnimate.capture!==null) setDraughtsCaptureAt(moveToAnimate.capture);
      else setDraughtsCaptureAt(null);
    };
    await animateMove(move,board[move.from]!);
    let applied=applyDraughtsMove(board,move);
    let nextBoard=applied.board;
    let nextForced=applied.forcedPiece;
    let nextSide=nextForced!==null?side:(side==="r"?"b":"r");
    let winner=getDraughtsWinner(nextBoard);
    let next:GameState={...current,board:nextBoard,forcedPiece:nextForced,turnId:nextSide==="r"?(active?.challenger_id??userId):(active?.opponent_id??"ai"),winner:winner?(winner==="r"?"Red wins!":"Black wins!"):null};
    setSelectedDraughtsPiece(nextForced);
    if(solo&&!winner&&nextSide==="b"){
      // Commit the player's completed move immediately, then give the computer a real three-second pause.
      setSoloState(next);
      setThinking(true);
      await new Promise(resolve=>window.setTimeout(resolve,3000));
      let aiBoard=nextBoard,aiForced:number|null=null,aiWinner:string|null=null;
      let safety=0;
      do {
        if (safety > 0) await new Promise(resolve=>window.setTimeout(resolve,450));
        const aiMoves=getDraughtsLegalMoves(aiBoard,"b",aiForced);
        if(!aiMoves.length)break;
        const captures=aiMoves.filter(candidate=>candidate.capture!==null);
        const choices=captures.length?captures:aiMoves;
        const aiMove=choices[Math.floor(Math.random()*choices.length)]!;
        await animateMove(aiMove,aiBoard[aiMove.from]!);
        const aiApplied=applyDraughtsMove(aiBoard,aiMove);
        aiBoard=aiApplied.board;
        aiForced=aiApplied.forcedPiece;
        aiWinner=getDraughtsWinner(aiBoard);
        // Keep the visible board in sync after every computer step, including multi-captures.
        setSoloState({...next,board:aiBoard,forcedPiece:aiForced,turnId:"ai",winner:aiWinner?(aiWinner==="r"?"Red wins!":"Black wins!"):null});
        safety++;
      } while(aiForced!==null&&!aiWinner&&safety<12);
      const finalWinner=aiWinner??getDraughtsWinner(aiBoard);
      next={...next,board:aiBoard,forcedPiece:null,turnId:userId,winner:finalWinner?(finalWinner==="r"?"Red wins!":"Black wins!"):null};
      setSoloState(next);
      setSelectedDraughtsPiece(null);
      setThinking(false);
      return;
    }
    if(active) await updateGame(next,winner?(winner==="r"?active.challenger_id:active.opponent_id):undefined);
    else setSoloState(next);
    if(nextForced===null)setSelectedDraughtsPiece(null);
  };

  const rollSnakesLadders = async () => {
    if(!current || selected!=="snakes-ladders" || current.winner || busy || ladderDiceRolling) return;
    if(active && current.turnId!==userId) return;
    if(!active && current.turnId!=="ai" && current.turnId!==userId) return;
    setBusy(true); setLadderMessage("");
    const animateTurn = async (positions:Record<string,number>, player:string) => {
      const start=positions[player]??0;
      const dice=rollFairDie();
      setLadderDiceRevealed(false);
      setLadderDiceFace(rollFairDie());
      setLadderDiceRolling(true);
      await new Promise(resolve=>window.setTimeout(resolve,650));
      setLadderDiceFace(dice);
      setLadderDiceRolling(false);
      setLadderDiceRevealed(true);
      // Keep the settled number visible for three full seconds before moving any piece.
      await new Promise(resolve=>window.setTimeout(resolve,3000));
      const landing=start+dice;
      const destination=landing>100?start:(SNAKES_LADDERS[landing]??landing);
      const nextPositions={...positions,[player]:start};
      setLadderVisualPositions({...nextPositions});
      for(let square=start+1;square<=Math.min(landing,100)&&landing<=100;square++){
        nextPositions[player]=square; setLadderVisualPositions({...nextPositions});
        await new Promise(resolve=>window.setTimeout(resolve,145));
      }
      if(landing>100) setLadderMessage(player==="ai"?"Computer needs an exact roll to reach 100.":"You need an exact roll to reach 100.");
      else if(destination!==landing){
        setLadderMessage(destination>landing?"Ladder! Climbing up! 🪜":"Snake! Sliding down! 🐍");
        await new Promise(resolve=>window.setTimeout(resolve,250));
        const step=destination>landing?1:-1;
        for(let square=landing+step;step>0?square<=destination:square>=destination;square+=step){
          nextPositions[player]=square; setLadderVisualPositions({...nextPositions});
          await new Promise(resolve=>window.setTimeout(resolve,55));
        }
      }
      const collision=resolveLadderCollision(nextPositions,player,destination);
      Object.assign(nextPositions,collision.positions);
      if(collision.kickedPlayer) setLadderMessage(player==="ai"?"You were landed on — back to start!":"You landed on your opponent — they go back to start!");
      return {positions:nextPositions,dice,destination,landing,kickedPlayer:collision.kickedPlayer};
    };
    try {
      const positions=(current.board as any).positions??{};
      const isComputerTurn=!active && current.turnId==="ai";
      if(!isComputerTurn) {
        const result=await animateTurn(positions,userId);
        const nextPositions=result.positions;
        const winner=nextPositions[userId]===100?"You win!":null;
        if(winner) {
          const next={...current,board:{positions:nextPositions,dice:result.dice},turnId:userId,winner};
          setLadderMessage("You reached 100 — you win! 🏆");
          if(active) await updateGame(next,userId); else setSoloState(next);
          return;
        }
        if(result.dice===6) {
          const next={...current,board:{positions:nextPositions,dice:result.dice},turnId:userId,winner:null};
          setLadderMessage("You rolled a 6! 🎉 You get another turn — tap Roll dice when you're ready.");
          if(active) await updateGame(next); else setSoloState(next);
          return;
        }
        if(result.kickedPlayer) setLadderMessage(result.kickedPlayer===userId?"Your opponent landed on you — back to start!":"You landed on your opponent — they go back to start!");
        if(active) {
          const opponentId=userId===active.challenger_id?(active.opponent_id??userId):active.challenger_id;
          const next={...current,board:{positions:nextPositions,dice:result.dice},turnId:opponentId,winner:null};
          setLadderMessage("Your turn is over — opponent's turn.");
          await updateGame(next);
          return;
        }
        // In solo play, the computer only starts after the player's non-six roll.
        let computerPositions=nextPositions;
        let computerRoll=0;
        let computerWinner:string|null=null;
        let computerKickedPlayer:string|null=null;
        do {
          setLadderMessage("Computer's turn…");
          await new Promise(resolve=>window.setTimeout(resolve,550));
          const ai=await animateTurn(computerPositions,"ai");
          computerPositions=ai.positions;
          computerRoll=ai.dice;
          computerKickedPlayer=ai.kickedPlayer;
          computerWinner=computerPositions.ai===100?"Computer wins!":null;
          if(computerWinner) break;
          if(computerRoll===6) setLadderMessage("Computer rolled a 6 — it gets another turn! 🎲");
        } while(computerRoll===6);
        const next={...current,board:{positions:computerPositions,dice:computerRoll},turnId:userId,winner:computerWinner};
        setLadderMessage(computerWinner?"Computer reached 100 — game over!":computerKickedPlayer===userId?"Computer landed on you — back to start!":"Your turn — roll the dice!");
        setSoloState(next);
        return;
      }
      // Computer's extra rolls are automatic because it is the computer's turn.
      let computerPositions=positions;
      let computerRoll=0;
      let computerWinner:string|null=null;
      do {
        const ai=await animateTurn(computerPositions,"ai");
        computerPositions=ai.positions;
        computerRoll=ai.dice;
        computerWinner=computerPositions.ai===100?"Computer wins!":null;
        if(computerWinner) break;
        if(computerRoll===6) setLadderMessage("Computer rolled a 6 — it gets another turn! 🎲");
      } while(computerRoll===6);
      const next={...current,board:{positions:computerPositions,dice:computerRoll},turnId:userId,winner:computerWinner};
      setLadderMessage(computerWinner?"Computer reached 100 — game over!":"Your turn — roll the dice!");
      setSoloState(next);
    } finally { setBusy(false); }
  };

  const chooseRps = async (choice: string) => {
    if (!current || current.choices?.[userId] || (active && !isMyTurn) || rpsCountdown) return;
    setRpsCountdown("Rock…");
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    setRpsCountdown("Paper…");
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    setRpsCountdown("Scissors…");
    await new Promise((resolve) => window.setTimeout(resolve, 340));
    setRpsCountdown("Shoot!");
    const choices = { ...(current.choices ?? {}), [userId]: choice };
    let winnerId: string | null | undefined;
    let winner = "";
    let turnId = current.turnId;
    if (active?.opponent_id && choices[active.challenger_id] && choices[active.opponent_id]) {
      const a=choices[active.challenger_id], b=choices[active.opponent_id];
      winner = a===b ? "draw" : ((a==="rock"&&b==="scissors")||(a==="paper"&&b==="rock")||(a==="scissors"&&b==="paper")) ? "X" : "O";
      winnerId = winner==="draw" ? null : winner==="X" ? active.challenger_id : active.opponent_id;
    } else if (active?.opponent_id) { turnId=active.opponent_id; }
    else if (!active) {
      choices["ai"]=["rock","paper","scissors"][Math.floor(Math.random()*3)] ?? "rock";
      const a=choices[userId], b=choices["ai"];
      winner = a===b ? "draw" : ((a==="rock"&&b==="scissors")||(a==="paper"&&b==="rock")||(a==="scissors"&&b==="paper")) ? "You win!" : "Computer wins";
    }
    const next={...current,choices,winner,turnId};
    if(active) await updateGame(next,winnerId); else setSoloState(next);
    window.setTimeout(()=>setRpsCountdown(""),500);
  };
  const submitWord = async () => {
    if(!current || current.winner || (active && !isMyTurn)) return;
    if(answer.trim().toUpperCase()!==current.word) {
      setNotice("Not quite — try again!");
      if(active?.opponent_id) await updateGame({...current,turnId:userId===active.challenger_id?active.opponent_id:active.challenger_id},null);
      return;
    }
    const next={...current,winner:"Correct! 🎉"};
    if(active) await updateGame(next,userId); else setSoloState(next);
    setAnswer("");
  };
  const submitQuiz = async (index: number) => {
    if(!current || current.answers?.[userId]!==undefined || (active && !isMyTurn)) return;
    const activeQuestion=QUIZ[(current.questionPool?.[current.question] ?? current.question) % QUIZ.length]!;
    setQuizFeedback(index===activeQuestion.correct);
    const pool=current.questionPool?.length ? current.questionPool : [...QUIZ.keys()];
    const q=QUIZ[pool[current.question % pool.length] ?? 0]!;
    const correct=index===q.correct;
    const answers={...(current.answers??{}),[userId]:correct};
    if(!active) {
      const next={...current,answers,lastCorrect:correct,streak:correct?(current.streak??0)+1:0};
      setSoloState(next);
      return;
    }
    if(active.opponent_id && answers[active.challenger_id]!==undefined && answers[active.opponent_id]!==undefined) {
      const scores={...(current.scores??{}),[active.challenger_id]:(current.scores?.[active.challenger_id]??0)+(answers[active.challenger_id]?1:0),[active.opponent_id]:(current.scores?.[active.opponent_id]??0)+(answers[active.opponent_id]?1:0)};
      const nextQuestion=current.question+1;
      const nextFirst=current.turnId===active.challenger_id?active.opponent_id:active.challenger_id;
      await updateGame({...current,question:nextQuestion,answers:{},scores,turnId:nextFirst,streak:0,lastCorrect:undefined});
    } else await updateGame({...current,answers,turnId:active.opponent_id ?? current.turnId});
  };
  const nextQuizQuestion = () => {
    if (!current || !solo) return;
    setQuizFeedback(null);
    const nextQuestion=current.question+1;
    if(nextQuestion >= (current.questionPool?.length ?? QUIZ.length)) {
      setSoloState({...current,question:0,questionPool:[...QUIZ.keys()].sort(()=>Math.random()-0.5),answers:{},lastCorrect:undefined});
    } else setSoloState({...current,question:nextQuestion,answers:{},lastCorrect:undefined});
  };
  const cancelChallenge = async (challenge: Challenge) => {
    setBusy(true);
    const { error } = await (supabase as any).from("game_challenges").update({ status:"declined", updated_at:new Date().toISOString() }).eq("id",challenge.id).eq("challenger_id",userId).eq("status","pending");
    setBusy(false);
    if(error) { setNotice("Couldn't withdraw that challenge. Please try again."); return; }
    setActive(null); setSelected(null); setSolo(false); setNotice("Challenge withdrawn. You can start a solo game whenever you like."); await load();
  };

  const reset = async () => {
    if(!game) return;
    setLadderVisualPositions(null);setLadderMessage("");setDraughtsCaptureAt(null);setQuizFeedback(null);
    const next=initialState(game,active?.challenger_id??userId);
    snakeDirectionRef.current = "right";
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
        <button onClick={()=>{setSelected(null);setSelectedDraughtsPiece(null);setActive(null);setSolo(false);onClose();}} className="rounded-full p-2 hover:bg-secondary" aria-label="Back"><ArrowLeft className="size-5"/></button>
        <Gamepad2 className="size-5 text-primary"/><h2 className="font-semibold">Popotso Playtime</h2>
      </header>
      {!game ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 rounded-2xl bg-primary/10 p-4"><p className="font-semibold">A little friendly competition 💛</p><p className="mt-1 text-sm text-muted-foreground">Play together when you're both online, or enjoy a solo game whenever you like.</p></div>
          {notice && <p className="mb-3 rounded-xl bg-secondary p-3 text-sm">{notice}</p>}
          {incoming.length>0 && <section className="mb-5"><h3 className="mb-2 flex items-center gap-2 font-semibold"><Swords className="size-4"/> Challenges for you</h3>{incoming.map(c=><div key={c.id} className="mb-2 flex items-center justify-between rounded-xl border border-border p-3"><div><p className="font-medium">{GAMES.find(g=>g.id===c.game_type)?.name}</p><p className="text-xs text-muted-foreground">Someone challenged you</p></div><button disabled={busy} onClick={()=>void accept(c)} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Ready to join</button></div>)}</section>}
          {myOpen.length>0 && <section className="mb-3 space-y-2">{myOpen.map((challenge)=><div key={challenge.id} className="flex items-center justify-between rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Waiting for {partnerName} to accept {GAMES.find(g=>g.id===challenge.game_type)?.name}…</p><button disabled={busy} onClick={()=>void cancelChallenge(challenge)} className="rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive">Withdraw</button></div>)}</section>}
          {ongoing && <div className="mb-4 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3"><div><p className="font-semibold">Game in progress</p><p className="text-xs text-muted-foreground">{GAMES.find(g=>g.id===ongoing.game_type)?.name}</p></div><button onClick={()=>{setActive(ongoing);setSelected(ongoing.game_type);setSolo(false);}} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Resume game</button></div>}
          <div className="grid gap-3 sm:grid-cols-2">{GAMES.map(g=><article key={g.id} className="rounded-2xl border border-border p-4"><div className="text-3xl">{g.icon}</div><h3 className="mt-2 font-semibold">{g.name}</h3><p className="mt-1 min-h-9 text-xs text-muted-foreground">{g.detail}</p><div className="mt-3 flex gap-2">{g.id!=="snake" ? <button disabled={busy} onClick={()=>void createChallenge(g.id)} className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Challenge {partnerName}</button> : <span className="flex-1 rounded-xl bg-secondary px-3 py-2 text-center text-xs text-muted-foreground">Solo only</span>}<button onClick={()=>startSolo(g.id)} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold">Solo</button></div></article>)}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-md">
            <div className="mb-4 flex items-center justify-between"><button onClick={()=>{setSelected(null);setActive(null);setSolo(false);}} className="text-sm text-primary">← All games</button><span className="text-xs text-muted-foreground">{solo?"Single player":active?.status==="pending"?"Challenge sent":"Two player"}</span></div>
            <h3 className="mb-2 text-center text-xl font-bold">{title}</h3>
            {waiting && <div className="rounded-2xl bg-secondary p-4 text-center"><Loader2 className="mx-auto mb-2 size-6 animate-spin"/><p className="font-semibold">Challenge sent!</p><p className="text-sm text-muted-foreground">Waiting for {partnerName} to join.</p><button disabled={busy} onClick={()=>{if(active) void cancelChallenge(active);}} className="mt-3 rounded-full border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive">Withdraw challenge</button></div>}
            {active?.status==="active" && <div className="mb-3 rounded-xl border border-border bg-card p-3">
              {active.state.computerTakeoverBy ? <>
                <p className="text-center text-sm font-semibold">🤖 Computer is temporarily playing {active.state.computerTakeoverBy===userId?"your":"your partner's"} side.</p>
                {active.state.computerTakeoverBy===userId && <button onClick={()=>void takeBackControl()} className="mt-2 w-full rounded-xl bg-primary p-2.5 text-sm font-bold text-primary-foreground">Take Back Control</button>}
              </> : active.state.turnId===userId ? <button onClick={()=>void requestComputerTakeover()} disabled={busy} className="w-full rounded-xl border border-primary/40 p-2.5 text-sm font-semibold">🤖 Let Computer Take Over</button> : <p className="text-center text-xs text-muted-foreground">Your partner can hand over to the computer if they need to step away.</p>}
            </div>}
            {active?.status==="active" && <p className="mb-3 text-center text-sm text-muted-foreground">{isMyTurn?"Your turn!":"Waiting for the other player…"}</p>}
            {thinking && <p className="my-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary"/><span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]"/><span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]"/> Computer is thinking…</p>}
            {rpsCountdown && <p className="my-3 text-center text-xl font-bold text-primary">{rpsCountdown}</p>}
            {game==="rock-paper-scissors" && current?.choices && Object.keys(current.choices).length > 0 && <div className="my-4 flex items-center justify-center gap-5 rounded-2xl bg-secondary/70 p-4"><div className="text-center"><p className="text-xs text-muted-foreground">You</p><p className="text-4xl">{({rock:"✊",paper:"✋",scissors:"✌️"} as Record<string,string>)[current.choices[userId] ?? ""] ?? "…"}</p></div><span className="text-sm font-bold text-muted-foreground">VS</span><div className="text-center"><p className="text-xs text-muted-foreground">{solo ? "Computer" : partnerName}</p><p className="text-4xl">{({rock:"✊",paper:"✋",scissors:"✌️"} as Record<string,string>)[current.choices[solo ? "ai" : (active?.challenger_id === userId ? active?.opponent_id ?? "" : active?.challenger_id ?? "")] ?? ""] ?? "…"}</p></div></div>}
            {game==="tic-tac-toe" && <div className="relative mx-auto max-w-[300px]">
              <div className="grid grid-cols-3 gap-2">{(current?.board??[]).map((v:string,i:number)=><button key={i} disabled={!isMyTurn||thinking||Boolean(v)||Boolean(current?.winner)||waiting} onClick={()=>void playTtt(i)} className={`aspect-square rounded-2xl border border-border bg-card text-4xl font-bold transition-all duration-200 active:scale-95 ${current?.winnerLine?.includes(i)?"bg-primary/20 ring-2 ring-primary animate-pulse":""}`}>{v}</button>)}</div>
              {current?.winnerLine?.length===3 && <svg viewBox="0 0 300 300" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"><line x1={(current.winnerLine[0]!%3)*100+50} y1={Math.floor(current.winnerLine[0]!/3)*100+50} x2={(current.winnerLine[2]!%3)*100+50} y2={Math.floor(current.winnerLine[2]!/3)*100+50} stroke="currentColor" strokeWidth="8" strokeLinecap="round" className="text-primary"/></svg>}
            </div>}
            {game==="connect-four" && <div className="mx-auto max-w-[340px]">
              <style>{'@keyframes connect-four-disc-drop{0%{transform:translateY(-650%);opacity:.55}68%{transform:translateY(7%)}84%{transform:translateY(-3%)}100%{transform:translateY(0);opacity:1}}'}</style>
              <div className="mb-1 grid grid-cols-7 gap-1">{Array.from({length:7},(_,col)=><button key={col} type="button" onClick={()=>void playConnect(col)} disabled={!isMyTurn||thinking||Boolean(current?.winner)||waiting||Boolean(current?.board?.[0]?.[col])} aria-label={`Drop disc in column ${col+1}`} className="rounded-t-lg bg-blue-700 py-2 text-sm font-bold text-white disabled:opacity-40">↓</button>)}</div>
              <div className="relative grid grid-cols-7 gap-1 rounded-b-2xl bg-blue-600 p-2">{(current?.board??[]).flatMap((row:string[],r:number)=>row.map((v:string,c:number)=><div key={r+"-"+c} className={`aspect-square rounded-full border border-blue-800 ${v==="X"?"bg-red-400":v==="O"?"bg-yellow-300":"bg-white"} ${current?.winnerLine?.includes(r*7+c)?"ring-4 ring-white shadow-[0_0_0_3px_rgba(255,255,255,0.45)]":""}`} style={connectLastDrop?.row===r&&connectLastDrop?.col===c&&connectLastDrop?.mark===v?{animation:"connect-four-disc-drop 720ms cubic-bezier(.22,.8,.25,1) both"}:undefined}/>))}
                {current?.winnerLine?.length===4 && <svg viewBox="0 0 700 600" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"><line x1={(current.winnerLine[0]!%7)*100+50} y1={Math.floor(current.winnerLine[0]!/7)*100+50} x2={(current.winnerLine[3]!%7)*100+50} y2={Math.floor(current.winnerLine[3]!/7)*100+50} stroke="white" strokeWidth="13" strokeLinecap="round"/></svg>}
              </div>
            </div>}
            {game==="draughts" && <div className="mx-auto max-w-[360px]">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold">🔴 Red: {(current?.board as string[] ?? []).filter(piece=>draughtsSide(piece)==="r").length}</span>
                <span className="text-muted-foreground">{solo?(current?.turnId==="ai"?"Computer's turn":"Your turn"):(isMyTurn?"Your turn":"Opponent's turn")}</span>
                <span className="font-semibold">⚫ Black: {(current?.board as string[] ?? []).filter(piece=>draughtsSide(piece)==="b").length}</span>
              </div>
              <div className="relative aspect-square overflow-hidden rounded-xl border-4 border-amber-950 shadow-lg">
                <div className="grid h-full w-full grid-cols-8">
                  {(current?.board as string[] ?? []).map((piece:string,index:number)=>{
                    const row=Math.floor(index/8),col=index%8;
                    const side=solo?(current?.turnId==="ai"?"b":"r"):(active?.challenger_id===userId?"r":"b");
                    const board=(current?.board as string[]) ?? [];
                    const legal=getDraughtsLegalMoves(board,side,current?.forcedPiece??null);
                    const selectable=legal.some(move=>move.from===index);
                    const target=selectedDraughtsPiece!==null&&legal.some(move=>move.from===selectedDraughtsPiece&&move.to===index);
                    const selected=selectedDraughtsPiece===index;
                    const movingSource=draughtsAnimation?.from===index;
                    const traced=draughtsLastMove&&(draughtsLastMove.from===index||draughtsLastMove.to===index);
                    return <button key={index} type="button" onClick={()=>void playDraughts(index)} disabled={!isMyTurn||thinking||busy||Boolean(draughtsAnimation)||Boolean(current?.winner)||waiting} aria-label={"Square "+(row+1)+", "+(col+1)+(piece?", "+(piece==="r"?"red":piece==="b"?"black":piece==="R"?"red king":"black king")+" piece":"")} className={"relative flex aspect-square items-center justify-center "+((row+col)%2===0?"bg-amber-100":"bg-amber-800")+" "+(selected?"z-10 ring-4 ring-inset ring-sky-400":"")+" "+(traced?"ring-2 ring-inset ring-sky-300/80":"")+" "+(draughtsCaptureAt===index?"ring-4 ring-inset ring-rose-500":"")+" "+(target?"after:absolute after:size-3 after:rounded-full after:bg-emerald-400/90":"")}>
                      {piece&&!movingSource&&<span className={"flex h-[76%] w-[76%] items-center justify-center rounded-full border-[3px] text-sm font-black shadow-md "+(draughtsSide(piece)==="r"?"border-red-950 bg-red-600 text-white":"border-neutral-950 bg-neutral-900 text-white")+" "+(piece===piece.toUpperCase()?"ring-2 ring-yellow-300":"")}>{piece===piece.toUpperCase()?"♛":""}</span>}
                      {selectable&&!piece&&<span className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-emerald-300"/>}
                    </button>;
                  })}
                </div>
                {draughtsAnimation&&<div className="pointer-events-none absolute z-30 flex h-[12.5%] w-[12.5%] items-center justify-center" style={{left:(draughtsAnimation.from%8)*12.5+"%",top:Math.floor(draughtsAnimation.from/8)*12.5+"%",transform:draughtsAnimation.phase==="start"?"translate(0%, 0%)":"translate("+((draughtsAnimation.to%8-draughtsAnimation.from%8)*800)+"%, "+((Math.floor(draughtsAnimation.to/8)-Math.floor(draughtsAnimation.from/8))*800)+"%)",transition:"transform 1400ms cubic-bezier(0.22, 0.8, 0.25, 1)"}}>
                  <span className={"flex h-[76%] w-[76%] items-center justify-center rounded-full border-[3px] text-sm font-black shadow-xl "+(draughtsSide(draughtsAnimation.piece)==="r"?"border-red-950 bg-red-600 text-white":"border-neutral-950 bg-neutral-900 text-white")+" "+(draughtsAnimation.piece===draughtsAnimation.piece.toUpperCase()?"ring-2 ring-yellow-300":"")}>{draughtsAnimation.piece===draughtsAnimation.piece.toUpperCase()?"♛":""}</span>
                </div>}
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">{current?.forcedPiece!==null&&current?.forcedPiece!==undefined?"You must continue jumping with the selected piece.":"Tap one of your pieces, then tap a highlighted square to move."} Kings can move and capture backwards. Recent move is briefly traced on the board.</p>
              <button onClick={()=>setSelectedDraughtsPiece(null)} className="mt-2 w-full rounded-xl border border-border p-2 text-xs font-semibold">Clear selection</button>
            </div>}
            {game==="rock-paper-scissors" && <div className="flex justify-center gap-3">{([["rock","✊"],["paper","✋"],["scissors","✌️"]] as [string, string][]).map(([v,e])=><button key={v} onClick={()=>void chooseRps(v)} disabled={Boolean(current?.choices?.[userId])||waiting||!isMyTurn} className="rounded-2xl border border-border bg-card p-5 text-4xl shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md active:scale-90 disabled:opacity-50">{e}</button>)}</div>}
            {game==="word-scramble" && <div className="rounded-2xl border border-border p-5 text-center"><p className="text-xs text-muted-foreground">Unscramble this word</p><div className="my-4 flex flex-wrap justify-center gap-1.5">{(current?.scrambled??"HNSIUNES").split("").map((letter:string,index:number)=><span key={`${letter}-${index}`} className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-xl font-black shadow-sm animate-[bounce-in_250ms_ease-out]" style={{animationDelay:`${index*35}ms`}}>{letter}</span>)}</div><input value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Your answer" className="w-full rounded-xl border border-border bg-card p-3 text-center uppercase"/><button disabled={waiting || !isMyTurn || Boolean(current?.winner)} onClick={()=>void submitWord()} className="mt-3 w-full rounded-xl bg-primary p-3 text-sm font-semibold text-primary-foreground">Check answer</button></div>}
            {game==="quick-quiz" && <div className="rounded-2xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-primary">Question {(current?.question??0)+1}</span><span className="text-sm font-bold">{solo ? `Streak: ${current?.streak??0} 🔥` : `Score: ${(current?.scores?.[userId]??0)}–${(current?.scores?.[active?.opponent_id??""]??0)}`}</span></div><p className="font-semibold">{QUIZ[(current?.questionPool?.[current?.question??0] ?? (current?.question??0)) % QUIZ.length]!.q}</p><div className="mt-3 grid gap-2">{QUIZ[(current?.questionPool?.[current?.question??0] ?? (current?.question??0)) % QUIZ.length]!.a.map((a,i)=><button key={a} onClick={()=>void submitQuiz(i)} disabled={waiting||current?.answers?.[userId]!==undefined||!isMyTurn} className={`rounded-xl border p-3 text-left text-sm transition-all duration-200 active:scale-[0.98] ${current?.answers?.[userId]!==undefined&&i===QUIZ[(current?.questionPool?.[current?.question??0] ?? (current?.question??0)) % QUIZ.length]!.correct?"border-emerald-500 bg-emerald-500/15":current?.answers?.[userId]===false&&quizFeedback===false?"border-rose-500 bg-rose-500/10":"border-border"}`}>{a}</button>)}</div>{solo && current?.lastCorrect!==undefined && <div className="mt-3 rounded-xl bg-secondary p-3 text-sm">{current.lastCorrect?"Correct! Great job! 🎉":"Good try! Keep going 💛"}<button onClick={nextQuizQuestion} className="mt-3 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">Next Question ➡️</button></div>}</div>}
            {game==="snake" && <div className="mx-auto max-w-[340px]">
              <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Score: {(current?.board as any)?.score ?? 0}</span><span className="text-xs text-muted-foreground">Use arrows or swipe buttons</span></div>
              <div onTouchStart={event=>{const t=event.touches[0];if(t)snakeTouchStart.current={x:t.clientX,y:t.clientY};}} onTouchEnd={event=>{const start=snakeTouchStart.current;const t=event.changedTouches[0];snakeTouchStart.current=null;if(!start||!t)return;const dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.max(Math.abs(dx),Math.abs(dy))<22)return;if(Math.abs(dx)>Math.abs(dy))setSnakeDirection(dx>0?"right":"left");else setSnakeDirection(dy>0?"down":"up");}} onTouchMove={event=>event.preventDefault()} onContextMenu={event=>event.preventDefault()} className="grid gap-px overflow-hidden rounded-xl border-4 border-emerald-700 bg-emerald-100 p-1" style={{aspectRatio:"1 / 1",gridTemplateColumns:"repeat(16,minmax(0,1fr))",touchAction:"none",userSelect:"none"}}>
                {Array.from({length:256},(_,index)=>{
                  const x=index%16,y=Math.floor(index/16);
                  const body=(current?.board as any)?.body ?? [];
                  const isHead=body[0]?.[0]===x&&body[0]?.[1]===y;
                  const isBody=body.some((part:number[],i:number)=>i>0&&part[0]===x&&part[1]===y);
                  const food=(current?.board as any)?.food ?? [];
                  const isFood=food[0]===x&&food[1]===y;
                  return <div key={index} className={`aspect-square rounded-[3px] transition-colors duration-100 ${isHead?"bg-emerald-900 shadow-inner":isBody?"bg-emerald-600":isFood?"rounded-full bg-red-500 animate-pulse":"bg-emerald-50"}`}/>;
                })}
              </div>
              <div className="mx-auto mt-4 grid w-56 grid-cols-3 gap-3">
                <span/>
                <button aria-label="Move up" onClick={()=>setSnakeDirection("up")} className="min-h-16 rounded-2xl border border-border bg-secondary text-3xl shadow-sm active:scale-95">↑</button>
                <span/>
                <button aria-label="Move left" onClick={()=>setSnakeDirection("left")} className="min-h-16 rounded-2xl border border-border bg-secondary text-3xl shadow-sm active:scale-95">←</button>
                <button aria-label="Move down" onClick={()=>setSnakeDirection("down")} className="min-h-16 rounded-2xl border border-border bg-secondary text-3xl shadow-sm active:scale-95">↓</button>
                <button aria-label="Move right" onClick={()=>setSnakeDirection("right")} className="min-h-16 rounded-2xl border border-border bg-secondary text-3xl shadow-sm active:scale-95">→</button>
              </div>
              {current?.winner && <button onClick={()=>void reset()} className="mt-3 w-full rounded-xl bg-primary p-3 text-sm font-semibold text-primary-foreground">Play again</button>}
            </div>}
            {game==="snakes-ladders" && <div className="mx-auto max-w-[360px]">
              <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">First to square 100 wins</p><button disabled={busy||ladderDiceRolling||Boolean(current?.winner)||Boolean(active&&current?.turnId!==userId)||waiting} onClick={()=>void rollSnakesLadders()} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">🎲 Roll dice</button></div>
              <div className="mb-2 flex items-center justify-center gap-3"><div className={`flex size-14 items-center justify-center rounded-2xl border-2 border-primary/30 bg-card text-3xl shadow-md ${ladderDiceRolling?"animate-bounce":""}`}>{ladderDiceRolling||ladderDiceRevealed?["","⚀","⚁","⚂","⚃","⚄","⚅"][ladderDiceFace]:["","⚀","⚁","⚂","⚃","⚄","⚅"][current?.board?.dice??0]??"🎲"}</div><p className="text-sm text-muted-foreground">{ladderDiceRolling?"Rolling…":ladderDiceRevealed?`You rolled: ${ladderDiceFace} — moving in 3 seconds`:current?.board?.dice?`Last roll: ${current.board.dice}`:"Roll to begin"} · {active?(isMyTurn?"Your turn":"Opponent's turn"):"You vs Computer"}</p></div>{ladderMessage&&<p className="mb-2 rounded-xl bg-primary/10 p-2 text-center text-sm font-semibold">{ladderMessage}</p>}
              <div className="grid grid-cols-10 gap-0.5 overflow-hidden rounded-xl border border-border bg-secondary p-1">
                {Array.from({length:100},(_,index)=>{
                  const row=Math.floor(index/10),col=index%10,rowFromBottom=9-row;
                  const offset=rowFromBottom%2===0?col:9-col;
                  const number=rowFromBottom*10+offset+1;
                  const positions=ladderVisualPositions??(current?.board as any)?.positions??{};
                  const userHere=positions[userId]===number;
                  const opponentKey=active?(userId===active.challenger_id?active.opponent_id:active.challenger_id):"ai";
                  const opponentHere=opponentKey && positions[opponentKey]===number;
                  const jump=SNAKES_LADDERS[number];
                  return <div key={number} className={`relative flex aspect-square flex-col items-center justify-center rounded-sm text-[9px] font-semibold ${jump?(jump>number?"bg-emerald-200 text-emerald-900":"bg-rose-200 text-rose-900"):"bg-card"}`}>
                    <span>{number}</span>
                    {jump && <span className="text-[7px]">{jump>number?"↗":"↘"}{jump}</span>}
                    <div className="absolute bottom-0 flex gap-0.5">{userHere&&<span className="size-2 rounded-full bg-blue-600 ring-2 ring-white transition-all duration-100"/>}{opponentHere&&<span className="size-2 rounded-full bg-amber-500 ring-2 ring-white transition-all duration-100"/>}</div>
                  </div>;
                })}
              </div>
              <div className="mt-2 flex justify-center gap-4 text-xs"><span>🔵 You: {(current?.board as any)?.positions?.[userId]??0}</span><span>🟠 {solo?"Computer":partnerName}: {(current?.board as any)?.positions?.[active?(userId===active.challenger_id?active.opponent_id:active.challenger_id):"ai"]??0}</span></div>
            </div>}
            {active?.status === "active" && <section className="mt-5 rounded-2xl border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">Game chat</h4><span className="text-[11px] text-muted-foreground">Quick messages</span></div>
              <div className="max-h-36 space-y-2 overflow-y-auto rounded-xl bg-secondary/50 p-2">
                {gameMessages.length===0 && <p className="py-3 text-center text-xs text-muted-foreground">Send a quick message without leaving the game 💬</p>}
                {gameMessages.map((msg:any)=><div key={msg.id} className={msg.sender_id===userId?"ml-8 rounded-xl bg-primary/10 p-2":"mr-8 rounded-xl bg-secondary p-2"}>
                  <p className="mb-0.5 text-[10px] font-semibold text-muted-foreground">{msg.sender_id===userId?"You":partnerName}</p>
                  <p className="break-words text-sm">{msg.message}</p>
                  <p className="mt-1 text-right text-[9px] text-muted-foreground">{new Date(msg.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</p>
                </div>)}
                <div ref={gameMessagesEndRef}/>
              </div>
              <form onSubmit={event=>{event.preventDefault();void sendGameMessage();}} className="mt-2 flex gap-2">
                <input value={gameMessageDraft} onChange={event=>setGameMessageDraft(event.target.value)} maxLength={500} placeholder="Type a quick message…" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"/>
                <button type="submit" disabled={!gameMessageDraft.trim()||sendingGameMessage} aria-label="Send game message" className="rounded-xl bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="size-4"/></button>
              </form>
            </section>}
            {current?.winner && <div className="mt-4 rounded-2xl bg-primary/10 p-4 text-center"><Trophy className="mx-auto mb-1 size-6 text-primary"/><p className="font-bold">{current.winner==="draw"?"It's a draw!":current.winner==="X"?"X wins!":current.winner==="O"?"O wins!":current.winner}</p></div>}
            {notice && <p className="mt-3 text-center text-sm text-muted-foreground">{notice}</p>}
            <div className="mt-5 flex gap-2"><button onClick={()=>void reset()} className="flex-1 rounded-xl border border-border p-3 text-sm font-semibold">Play again</button><button onClick={()=>{setSelected(null);setActive(null);setSolo(false);}} className="flex-1 rounded-xl bg-secondary p-3 text-sm font-semibold">Choose another</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
