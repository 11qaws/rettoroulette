import type { Participant, Prize } from '../types';

const DEMO_NAMES = [
  '말랑콩',
  '구름냥',
  '딸기우유',
  '토끼풀',
  '버블티',
  '몽실이',
  '복숭아콩',
  '라벤더',
  '하트빔',
  '치즈냥',
  '별사탕',
  '코코팝',
  '해피젤리',
  '우주먼지',
  '포도소다',
  '핑크구름',
  '멜론빵',
  '달빛토끼',
  '연보라',
  '무지개콩',
  '사르르',
  '라떼냥',
  '젤리몽',
  '댕글댕글',
];

export const demoParticipants: Participant[] = DEMO_NAMES.map((name, index) => ({
  id: `demo-${index + 1}`,
  name,
  weight: 1,
  commentCount: index % 5 === 0 ? 2 : 1,
}));

export const demoPrizes: Prize[] = [
  { id: 'burger', name: '버거 세트', quantity: 3, weight: 1 },
  { id: 'cake', name: '아박 케이크', quantity: 2, weight: 1 },
  { id: 'coffee', name: '커피 쿠폰', quantity: 5, weight: 2 },
  { id: 'sticker', name: '레또 스티커 팩', quantity: 10, weight: 3 },
];
