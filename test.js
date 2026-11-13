const assert = require('assert');
const m = require('./app.js');

const members = ['A', 'B', 'C'];

// 1. 均等割り：3人で9000円、Aが支払い → 全員負担3000円、Aは+6000
let ex1 = m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members }, members);
assert.ok(ex1);
let bal = m.computeBalances(members, [ex1]);
assert.deepStrictEqual(bal.map(b => b.balance), [6000, -3000, -3000]);

// 2. 精算は最小回数：B→A 3000円、C→A 3000円の2件
let tr = m.settle(bal);
assert.deepStrictEqual(tr, [
  { from: 'B', to: 'A', amount: 3000 },
  { from: 'C', to: 'A', amount: 3000 },
]);

// 3. 一部だけ参加の支出：Bだけ不参加の1000円は A・C で500円ずつ
let ex2 = m.newExpense({ title: '昼食', payer: 'C', amount: 1000, participants: ['A', 'C'] }, members);
bal = m.computeBalances(members, [ex1, ex2]);
assert.deepStrictEqual(bal.map(b => b.balance), [5500, -3000, -2500]);
tr = m.settle(bal);
assert.strictEqual(tr.length, 2);
assert.strictEqual(tr.reduce((s, t) => s + t.amount, 0), 5500);
// 精算を適用すると全員ゼロになる
let after = bal.map(b => ({ member: b.member, balance: b.balance }));
tr.forEach(t => {
  after.find(b => b.member === t.from).balance += t.amount;
  after.find(b => b.member === t.to).balance -= t.amount;
});
assert.deepStrictEqual(after.map(b => b.balance), [0, 0, 0]);

// 4. 端数処理：1000円を3人で割ると 334・333・333（支払者Aに余り1円）
let ex3 = m.newExpense({ title: '端数', payer: 'A', amount: 1000, participants: members }, members);
bal = m.computeBalances(members, [ex3]);
assert.deepStrictEqual(bal.map(b => b.share), [334, 333, 333]);
assert.strictEqual(bal.reduce((s, b) => s + b.balance, 0), 0);

// 5. 複雑な精算でも送金回数が人数-1以下に収まる（貪欲法の上限）
const m4 = ['A', 'B', 'C', 'D'];
const exs = [
  m.newExpense({ title: 'e1', payer: 'A', amount: 4000, participants: m4 }, m4),
  m.newExpense({ title: 'e2', payer: 'B', amount: 1000, participants: ['B', 'C'] }, m4),
  m.newExpense({ title: 'e3', payer: 'D', amount: 3000, participants: ['A', 'D'] }, m4),
];
bal = m.computeBalances(m4, exs);
tr = m.settle(bal);
assert.ok(tr.length <= m4.length - 1, 'transfers=' + tr.length);
assert.strictEqual(bal.reduce((s, b) => s + b.balance, 0), 0);
after = bal.map(b => ({ member: b.member, balance: b.balance }));
tr.forEach(t => {
  after.find(b => b.member === t.from).balance += t.amount;
  after.find(b => b.member === t.to).balance -= t.amount;
});
assert.deepStrictEqual(after.map(b => b.balance), [0, 0, 0, 0]);

// 6. 不正入力は null：金額0・支払者がメンバー外・対象者なし・対象者の重複は1人分
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 0, participants: members }, members), null);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'Z', amount: 100, participants: members }, members), null);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 100, participants: [] }, members), null);
let dup = m.newExpense({ title: 'x', payer: 'A', amount: 100, participants: ['A', 'A', 'B'] }, members);
assert.deepStrictEqual(dup.participants, ['A', 'B']);

// 7. 支出に使われているメンバー削除の判定材料：totals
assert.deepStrictEqual(m.totals([ex1, ex2]), { count: 2, amount: 10000 });
assert.deepStrictEqual(m.totals([]), { count: 0, amount: 0 });

// 8. インポート検証：不正な支出は落とし、形が壊れたものは null
let imp = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [
  { title: '宿', payer: 'A', amount: 2000, participants: ['A', 'B'] },
  { title: 'bad', payer: 'Z', amount: 500, participants: ['A'] },
]});
assert.strictEqual(imp.expenses.length, 1);
assert.strictEqual(m.validateImport({ eventName: 'x', members: [], expenses: [] }), null);
assert.strictEqual(m.validateImport(null), null);

// v0.2で追加分はファイル末尾のグループ9〜11

// 9. 旧単一イベント形式（v0.1）からの移行：1イベント化され、データが残る
let old = m.migrateStore({ eventName: '合宿', members: ['A', 'B'], expenses: [
  { title: '宿', payer: 'A', amount: 2000, participants: ['A', 'B'] },
]});
assert.ok(old && old.events.length === 1);
assert.strictEqual(old.activeEventId, old.events[0].id);
assert.deepStrictEqual(old.events[0].members, ['A', 'B']);
assert.strictEqual(old.events[0].expenses.length, 1);
assert.strictEqual(m.migrateStore(null), null);
assert.strictEqual(m.migrateStore({ eventName: 'x', members: [], expenses: [] }), null);

// 10. 複数イベント形式の検証：不正なイベントは落とし、activeが無ければ先頭になる
let store = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [] },
  { id: 'e2', eventName: '飲み会', members: ['A', 'C'], expenses: [] },
  { id: 'e3', eventName: '壊れた', members: [], expenses: [] },
], activeEventId: 'e2' });
assert.strictEqual(store.events.length, 2);
assert.strictEqual(store.activeEventId, 'e2');
let store2 = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A'], expenses: [] },
], activeEventId: '存在しない' });
assert.strictEqual(store2.activeEventId, 'e1');
assert.strictEqual(m.validateStore({ events: [] }), null);
assert.strictEqual(m.validateStore({ eventName: 'x' }), null);

// 11. イベント削除：切り替え先の維持と、最後の1件削除で空イベントが残る
let evs = [m.newEvent('合宿'), m.newEvent('飲み会')];
let removed = m.removeEvent(evs, evs[1].id, evs[1].id);
assert.strictEqual(removed.events.length, 1);
assert.strictEqual(removed.activeEventId, evs[0].id);
let removedLast = m.removeEvent(evs.slice(0, 1), evs[0].id, evs[0].id);
assert.strictEqual(removedLast.events.length, 1);
assert.strictEqual(removedLast.events[0].members.length, 0);
assert.strictEqual(removedLast.activeEventId, removedLast.events[0].id);
// インポートした単一イベントJSONは新しいイベントとして追加できる（上書きしない）
let imp2 = m.validateImport({ eventName: '旅行', members: ['A', 'B'], expenses: [] });
let evNew = m.newEvent(imp2.eventName); evNew.members = imp2.members; evNew.expenses = imp2.expenses;
assert.strictEqual([...evs, evNew].length, 3);

// 12. v0.3 支払い済み：キー・分割・切替・整理・保存形式の互換
let trs = [{ from: 'B', to: 'A', amount: 3000 }, { from: 'C', to: 'A', amount: 3000 }];
assert.notStrictEqual(m.transferKey(trs[0]), m.transferKey(trs[1]));
assert.strictEqual(m.transferKey(trs[0]), m.transferKey({ from: 'B', to: 'A', amount: 3000 }));
let split = m.splitTransfers(trs, [m.transferKey(trs[0])]);
assert.deepStrictEqual(split.paid, [trs[0]]);
assert.deepStrictEqual(split.unpaid, [trs[1]]);
// 一致しないキーは無視される
assert.deepStrictEqual(m.splitTransfers(trs, ['["B","A",9999]']).paid, []);
assert.deepStrictEqual(m.togglePaidKey([], 'k1'), ['k1']);
assert.deepStrictEqual(m.togglePaidKey(['k1'], 'k1'), []);
assert.deepStrictEqual(m.prunePaidKeys(trs, [m.transferKey(trs[0]), '["X","Y",1]']), [m.transferKey(trs[0])]);
// インポート・保存形式：支払い済みキーが残り、旧データは空になる
let impPaid = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [],
  paidTransfers: [m.transferKey(trs[0]), 123, m.transferKey(trs[0])] });
assert.deepStrictEqual(impPaid.paidTransfers, [m.transferKey(trs[0])]);
let storePaid = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [], paidTransfers: ['k'] },
], activeEventId: 'e1' });
assert.deepStrictEqual(storePaid.events[0].paidTransfers, ['k']);
let storeOld = m.migrateStore({ eventName: '合宿', members: ['A', 'B'], expenses: [] });
assert.deepStrictEqual(storeOld.events[0].paidTransfers, []);
assert.deepStrictEqual(m.newEvent('x').paidTransfers, []);

// 13. v0.4 1人あたりプレビュー：computeBalances と同じ端数ルール
assert.deepStrictEqual(m.previewShares(9000, members, 'A', members),
  [{ member: 'A', share: 3000 }, { member: 'B', share: 3000 }, { member: 'C', share: 3000 }]);
assert.deepStrictEqual(m.previewShares(1000, members, 'A', members),
  [{ member: 'A', share: 334 }, { member: 'B', share: 333 }, { member: 'C', share: 333 }]);
// 支払者が対象外なら先頭の対象者に端数
assert.deepStrictEqual(m.previewShares(1001, ['B', 'C'], 'A', members),
  [{ member: 'B', share: 501 }, { member: 'C', share: 500 }]);
// 対象者1人なら全額
assert.deepStrictEqual(m.previewShares(500, ['B'], 'A', members), [{ member: 'B', share: 500 }]);
// 不正入力は null
assert.strictEqual(m.previewShares(0, members, 'A', members), null);
assert.strictEqual(m.previewShares(100, [], 'A', members), null);
assert.strictEqual(m.previewShares(100, members, 'Z', members), null);
// 表示文：割り切れる場合と端数がある場合
assert.strictEqual(m.formatPreview([{ member: 'A', share: 3000 }, { member: 'B', share: 3000 }]), '1人あたり 3,000円（2人で割る）');
assert.strictEqual(m.formatPreview([{ member: 'A', share: 334 }, { member: 'B', share: 333 }, { member: 'C', share: 333 }]), '1人あたり 333円（A は 334円）');
assert.strictEqual(m.formatPreview([]), '');
assert.strictEqual(m.formatPreview(null), '');

// 14. v0.5 「自分」表示：自分の残高・関わる送金の判定と保存形式の互換
let balMe = [{ member: 'A', paid: 9000, share: 3000, balance: 6000 },
  { member: 'B', paid: 0, share: 3000, balance: -3000 },
  { member: 'C', paid: 0, share: 3000, balance: -3000 }];
assert.deepStrictEqual(m.meBalance(balMe, 'B'), balMe[1]);
assert.strictEqual(m.meBalance(balMe, 'Z'), null);
assert.strictEqual(m.meBalance(balMe, ''), null);
assert.strictEqual(m.meBalance(balMe, null), null);
assert.strictEqual(m.involvesMe({ from: 'B', to: 'A', amount: 3000 }, 'B'), true);
assert.strictEqual(m.involvesMe({ from: 'B', to: 'A', amount: 3000 }, 'A'), true);
assert.strictEqual(m.involvesMe({ from: 'B', to: 'A', amount: 3000 }, 'C'), false);
assert.strictEqual(m.involvesMe({ from: 'B', to: 'A', amount: 3000 }, ''), false);
// インポート・保存形式：「自分」が残り、メンバー外の名前は空になる。旧データは空になる
let impMe = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [], me: 'B' });
assert.strictEqual(impMe.me, 'B');
assert.strictEqual(m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [], me: 'Z' }).me, '');
assert.strictEqual(m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [] }).me, '');
let storeMe = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [], me: 'A' },
], activeEventId: 'e1' });
assert.strictEqual(storeMe.events[0].me, 'A');
let storeOldMe = m.migrateStore({ eventName: '合宿', members: ['A', 'B'], expenses: [] });
assert.strictEqual(storeOldMe.events[0].me, '');
assert.strictEqual(m.newEvent('x').me, '');

// 15. v0.6 精算まとめテキスト：画面の送金リストと同じ内容・同じ端数ルール
let evText = { eventName: '合宿', members: ['A', 'B', 'C'],
  expenses: [m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members }, members)],
  paidTransfers: [], me: '' };
assert.strictEqual(m.settlementText(evText),
  '【わりかんメモ】合宿\nB → A：3,000円\nC → A：3,000円\n残り 6,000円（2件）');
// 1件だけ支払い済みなら（支払い済み）付きで残額が減る
let evTextPaid = Object.assign({}, evText, { paidTransfers: [m.transferKey({ from: 'B', to: 'A', amount: 3000 })] });
assert.strictEqual(m.settlementText(evTextPaid),
  '【わりかんメモ】合宿\nC → A：3,000円\nB → A：3,000円（支払い済み）\n残り 3,000円（1件）');
// 全件支払い済みなら残額ではなく全件済みになる
let evTextAll = Object.assign({}, evText, { paidTransfers: [
  m.transferKey({ from: 'B', to: 'A', amount: 3000 }),
  m.transferKey({ from: 'C', to: 'A', amount: 3000 })] });
assert.strictEqual(m.settlementText(evTextAll),
  '【わりかんメモ】合宿\nB → A：3,000円（支払い済み）\nC → A：3,000円（支払い済み）\n全て支払い済みです。');
// 支出がなければ「支出はまだありません」、支出はあるが送金がなければ「全員精算済みです」
assert.strictEqual(m.settlementText({ eventName: '', members: ['A'], expenses: [], paidTransfers: [] }),
  '【わりかんメモ】名前なしのイベント\n支出はまだありません。');
assert.strictEqual(m.settlementText({ eventName: '飲み会', members: ['A', 'B'],
  expenses: [m.newExpense({ title: 'x', payer: 'A', amount: 1000, participants: ['A'], }, ['A', 'B'])], paidTransfers: [] }),
  '【わりかんメモ】飲み会\n全員精算済みです。');

// 16. v0.7 支出の編集：id は元のまま、内容だけ置き換わる。無効・不明な id は null
let exList = [
  m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members }, members),
  m.newExpense({ title: '昼食', payer: 'C', amount: 1000, participants: ['A', 'C'] }, members),
];
let targetId = exList[0].id;
let edited = m.editExpense(exList, targetId,
  { title: '宿泊代', payer: 'B', amount: 6000, participants: ['A', 'B'], memo: '訂正' }, members);
assert.ok(edited);
assert.strictEqual(edited.length, 2);
assert.strictEqual(edited[0].id, targetId); // id は変わらない
assert.deepStrictEqual(
  { title: edited[0].title, payer: edited[0].payer, amount: edited[0].amount,
    participants: edited[0].participants, memo: edited[0].memo },
  { title: '宿泊代', payer: 'B', amount: 6000, participants: ['A', 'B'], memo: '訂正' });
assert.strictEqual(edited[1].id, exList[1].id); // 他の支出は触らない
assert.strictEqual(exList[0].amount, 9000); // 元の配列は変更しない
assert.strictEqual(m.editExpense(exList, '存在しないid',
  { title: 'x', payer: 'A', amount: 100, participants: members }, members), null);
assert.strictEqual(m.editExpense(exList, targetId,
  { title: 'x', payer: 'A', amount: 0, participants: members }, members), null);
assert.strictEqual(m.editExpense(exList, targetId,
  { title: 'x', payer: 'Z', amount: 100, participants: members }, members), null);
assert.strictEqual(m.editExpense(exList, targetId,
  { title: 'x', payer: 'A', amount: 100, participants: [] }, members), null);
// 編集後の残高が新しい金額で計算される
// （宿泊代6000円をA・Bで割る：A負担3000、Bは6000支払い−3000負担＝+3000、
//  昼食1000円をA・Cで割る：A負担+500、Cは1000支払い−500負担＝+500）
let balEdited = m.computeBalances(members, edited);
assert.deepStrictEqual(balEdited.map(b => b.balance), [-3500, 3000, 500]);

// 17. v0.8 メンバー名の変更：支出・「自分」・支払い済み印まで置き換わり、残高の数値は変わらない
let evRename = { id: 'e1', eventName: '合宿', members: ['A', 'B', 'C'],
  expenses: [
    m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members }, members),
    m.newExpense({ title: '昼食', payer: 'C', amount: 1000, participants: ['A', 'C'] }, members),
  ],
  paidTransfers: [m.transferKey({ from: 'B', to: 'A', amount: 3000 })], me: 'B' };
let renamed = m.renameMember(evRename, 'B', 'B2');
assert.ok(renamed);
assert.deepStrictEqual(renamed.members, ['A', 'B2', 'C']);
assert.deepStrictEqual(renamed.expenses[0].participants, ['A', 'B2', 'C']);
assert.strictEqual(renamed.expenses[1].payer, 'C'); // 関係ない支出は触らない
assert.strictEqual(renamed.me, 'B2');
// 支払い済み印はキーを書き換えて残る（送金内容は金額も含めて同じため）
assert.deepStrictEqual(renamed.paidTransfers, [m.transferKey({ from: 'B2', to: 'A', amount: 3000 })]);
// 改名後の送金リストでも支払い済みとして分けられる
let trRenamed = m.settle(m.computeBalances(renamed.members, renamed.expenses));
assert.deepStrictEqual(m.splitTransfers(trRenamed, renamed.paidTransfers).paid,
  [{ from: 'B2', to: 'A', amount: 3000 }]);
// 残高の数値は改名前と同じ
assert.deepStrictEqual(m.computeBalances(renamed.members, renamed.expenses).map(b => b.balance),
  m.computeBalances(members, evRename.expenses).map(b => b.balance));
// 元のイベントは変更しない
assert.deepStrictEqual(evRename.members, ['A', 'B', 'C']);
assert.strictEqual(evRename.me, 'B');
// 無効な改名は null：空・同じ名前・すでにいる名前・メンバーにいない名前
assert.strictEqual(m.renameMember(evRename, 'B', ''), null);
assert.strictEqual(m.renameMember(evRename, 'B', '  '), null);
assert.strictEqual(m.renameMember(evRename, 'B', 'B'), null);
assert.strictEqual(m.renameMember(evRename, 'B', 'A'), null);
assert.strictEqual(m.renameMember(evRename, 'Z', 'Z2'), null);
assert.strictEqual(m.renameMember(evRename, 'B', ' A '), null); // 前後の空白を除くと既存名
// 送金に関わらないメンバーの改名では、支払い済みキーはそのまま
let renamedC = m.renameMember(evRename, 'C', 'C2');
assert.deepStrictEqual(renamedC.paidTransfers, evRename.paidTransfers);
assert.strictEqual(renamedC.expenses[1].payer, 'C2');

// 18. v0.9 金額の正規化：全角数字・カンマ・「円」・空白を受け付ける
assert.strictEqual(m.normalizeAmount(1200), 1200);
assert.strictEqual(m.normalizeAmount('1200'), 1200);
assert.strictEqual(m.normalizeAmount('１２００'), 1200);
assert.strictEqual(m.normalizeAmount('1,200'), 1200);
assert.strictEqual(m.normalizeAmount('１，２００'), 1200);
assert.strictEqual(m.normalizeAmount('1200円'), 1200);
assert.strictEqual(m.normalizeAmount('１２００円'), 1200);
assert.strictEqual(m.normalizeAmount(' 1,200 '), 1200);
assert.strictEqual(m.normalizeAmount('￥1,200'), 1200);
assert.strictEqual(m.normalizeAmount('100.9'), 100.9); // 小数点以下は newExpense で切り捨て
assert.ok(isNaN(m.normalizeAmount('abc')));
assert.ok(isNaN(m.normalizeAmount('')));
assert.ok(isNaN(m.normalizeAmount('円')));
assert.ok(isNaN(m.normalizeAmount(null)));
// 正規化された金額で支出が記録でき、プレビュー・編集・読み込みにも同じく通る
let exFull = m.newExpense({ title: '宿', payer: 'A', amount: '１，２００円', participants: members }, members);
assert.ok(exFull);
assert.strictEqual(exFull.amount, 1200);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 'abc', participants: members }, members), null);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: '０', participants: members }, members), null);
assert.deepStrictEqual(m.previewShares('１，２００円', members, 'A', members),
  [{ member: 'A', share: 400 }, { member: 'B', share: 400 }, { member: 'C', share: 400 }]);
assert.strictEqual(m.previewShares('abc', members, 'A', members), null);
let editedFull = m.editExpense(exList, targetId,
  { title: '宿泊代', payer: 'A', amount: '2,500', participants: members }, members);
assert.ok(editedFull);
assert.strictEqual(editedFull[0].amount, 2500);
let impFull = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [
  { title: '宿', payer: 'A', amount: '1,200円', participants: ['A', 'B'] },
]});
assert.strictEqual(impFull.expenses[0].amount, 1200);

// 19. v0.11 端数設定：単位と切り上げ／切り捨てを選べる。標準は1円・切り上げ
// 正規化：不正な単位・扱いは標準に寄る
assert.deepStrictEqual(m.normalizeRounding(1, 'ceil'), { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(m.normalizeRounding(10, 'floor'), { unit: 10, mode: 'floor' });
assert.deepStrictEqual(m.normalizeRounding(100, 'ceil'), { unit: 100, mode: 'ceil' });
assert.deepStrictEqual(m.normalizeRounding(5, 'ceil'), { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(m.normalizeRounding(undefined, undefined), { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(m.normalizeRounding('100', 'floor'), { unit: 100, mode: 'floor' });
// 丸め：1000円を3人
assert.strictEqual(m.roundShare(1000, 3, { unit: 1, mode: 'ceil' }), 334);
assert.strictEqual(m.roundShare(1000, 3, { unit: 1, mode: 'floor' }), 333);
assert.strictEqual(m.roundShare(1000, 3, { unit: 10, mode: 'ceil' }), 340);
assert.strictEqual(m.roundShare(1000, 3, { unit: 10, mode: 'floor' }), 330);
assert.strictEqual(m.roundShare(1000, 3, { unit: 100, mode: 'ceil' }), 400);
assert.strictEqual(m.roundShare(1000, 3, { unit: 100, mode: 'floor' }), 300);
// 割り切れる場合はどちらでも同じ
assert.strictEqual(m.roundShare(9000, 3, { unit: 100, mode: 'ceil' }), 3000);
assert.strictEqual(m.roundShare(9000, 3, { unit: 100, mode: 'floor' }), 3000);
// 残高：丸め額は全員同じだが、差額は支払者が引き受けるため残高合計は常に0になる
// 切り上げ1円：他2人は334円ずつ、支払者Aの実質負担は332円（余り2円をAが受け取る）
// 切り捨て1円：他2人は333円ずつ、支払者Aの実質負担は334円（不足1円をAがかぶる）
let exRound = m.newExpense({ title: '端数', payer: 'A', amount: 1000, participants: members }, members);
let balCeil = m.computeBalances(members, [exRound], { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(balCeil.map(b => b.share), [332, 334, 334]);
assert.deepStrictEqual(balCeil.map(b => b.balance), [668, -334, -334]);
assert.strictEqual(balCeil.reduce((s, b) => s + b.balance, 0), 0);
let balFloor = m.computeBalances(members, [exRound], { unit: 1, mode: 'floor' });
assert.deepStrictEqual(balFloor.map(b => b.share), [334, 333, 333]);
assert.deepStrictEqual(balFloor.map(b => b.balance), [666, -333, -333]);
assert.strictEqual(balFloor.reduce((s, b) => s + b.balance, 0), 0);
// 支払者が対象外でも差額は支払者が引き受け、合計0・送金で全員ゼロになる
let exRoundOut = m.newExpense({ title: '端数外', payer: 'A', amount: 999, participants: ['B', 'C'] }, members);
let balOut = m.computeBalances(members, [exRoundOut], { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(balOut.map(b => b.balance), [1000, -500, -500]);
assert.strictEqual(balOut.reduce((s, b) => s + b.balance, 0), 0);
// 100円単位・切り上げの送金は400円ずつ
let bal100 = m.computeBalances(members, [exRound], { unit: 100, mode: 'ceil' });
assert.deepStrictEqual(m.settle(bal100), [
  { from: 'B', to: 'A', amount: 400 },
  { from: 'C', to: 'A', amount: 400 },
]);
// 設定なし（旧来呼び出し）は従来の1円ずつ配分が残る（互換）
assert.deepStrictEqual(m.computeBalances(members, [exRound]).map(b => b.share), [334, 333, 333]);
// プレビューも同じ丸め
assert.deepStrictEqual(m.previewShares(1000, members, 'A', members, { unit: 100, mode: 'ceil' }),
  [{ member: 'A', share: 400 }, { member: 'B', share: 400 }, { member: 'C', share: 400 }]);
assert.deepStrictEqual(m.previewShares(1000, members, 'A', members, { unit: 10, mode: 'floor' }),
  [{ member: 'A', share: 330 }, { member: 'B', share: 330 }, { member: 'C', share: 330 }]);
// 保存形式：新規イベントは標準、読み込みで設定が残り、旧データ・不正値は標準になる
assert.strictEqual(m.newEvent('x').roundingUnit, 1);
assert.strictEqual(m.newEvent('x').roundingMode, 'ceil');
let impRound = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [], roundingUnit: 100, roundingMode: 'floor' });
assert.strictEqual(impRound.roundingUnit, 100);
assert.strictEqual(impRound.roundingMode, 'floor');
assert.strictEqual(m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [] }).roundingUnit, 1);
assert.strictEqual(m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [], roundingUnit: 7, roundingMode: 'x' }).roundingMode, 'ceil');
let storeRound = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [], roundingUnit: 10, roundingMode: 'floor' },
], activeEventId: 'e1' });
assert.strictEqual(storeRound.events[0].roundingUnit, 10);
assert.strictEqual(storeRound.events[0].roundingMode, 'floor');
assert.deepStrictEqual(m.roundingFromEvent(storeRound.events[0]), { unit: 10, mode: 'floor' });
assert.deepStrictEqual(m.roundingFromEvent({}), { unit: 1, mode: 'ceil' });
assert.deepStrictEqual(m.roundingFromEvent(null), { unit: 1, mode: 'ceil' });
// 改名しても端数設定は残る
let renamedRound = m.renameMember({ id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [], paidTransfers: [], me: '', roundingUnit: 100, roundingMode: 'floor' }, 'A', 'A2');
assert.strictEqual(renamedRound.roundingUnit, 100);
assert.strictEqual(renamedRound.roundingMode, 'floor');
// 精算まとめも端数設定で計算される（100円・切り上げなら400円ずつ）
let evRoundText = { eventName: '合宿', members: ['A', 'B', 'C'],
  expenses: [exRound], paidTransfers: [], me: '', roundingUnit: 100, roundingMode: 'ceil' };
assert.strictEqual(m.settlementText(evRoundText),
  '【わりかんメモ】合宿\nB → A：400円\nC → A：400円\n残り 800円（2件）');

// 20. v0.12 四捨五入：単位の半分以上で切り上げ、未満で切り捨て（0.5は切り上げ）
assert.deepStrictEqual(m.normalizeRounding(10, 'round'), { unit: 10, mode: 'round' });
assert.strictEqual(m.roundingModeLabel('round'), '四捨五入');
assert.strictEqual(m.roundingModeLabel('ceil'), '切り上げ');
assert.strictEqual(m.roundingModeLabel('floor'), '切り捨て');
// 1000円を3人（1人あたり333.33…）
assert.strictEqual(m.roundShare(1000, 3, { unit: 1, mode: 'round' }), 333);
assert.strictEqual(m.roundShare(1000, 3, { unit: 10, mode: 'round' }), 330);
assert.strictEqual(m.roundShare(1000, 3, { unit: 100, mode: 'round' }), 300);
// 半分ちょうどは切り上げ：1050円を3人＝350円ちょうど、100円単位で400円。1049円を3人なら300円側
assert.strictEqual(m.roundShare(1050, 3, { unit: 100, mode: 'round' }), 400);
assert.strictEqual(m.roundShare(1049, 3, { unit: 100, mode: 'round' }), 300);
// 半分を超えれば切り上げ：1100円を3人＝366.66…、10円単位で370円
assert.strictEqual(m.roundShare(1100, 3, { unit: 10, mode: 'round' }), 370);
// 残高：四捨五入でも差額は支払者が引き受け、合計0・送金で精算完了になる
let exRoundHalf = m.newExpense({ title: '四捨五入', payer: 'A', amount: 1050, participants: members }, members);
let balRound = m.computeBalances(members, [exRoundHalf], { unit: 100, mode: 'round' });
assert.deepStrictEqual(balRound.map(b => b.balance), [800, -400, -400]);
assert.strictEqual(balRound.reduce((s, b) => s + b.balance, 0), 0);
assert.deepStrictEqual(m.settle(balRound), [
  { from: 'B', to: 'A', amount: 400 },
  { from: 'C', to: 'A', amount: 400 },
]);
// プレビュー・保存形式でも四捨五入が通る
assert.deepStrictEqual(m.previewShares(1000, members, 'A', members, { unit: 100, mode: 'round' }),
  [{ member: 'A', share: 300 }, { member: 'B', share: 300 }, { member: 'C', share: 300 }]);
let impRoundMode = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [], roundingUnit: 10, roundingMode: 'round' });
assert.strictEqual(impRoundMode.roundingMode, 'round');
let evRoundModeText = { eventName: '合宿', members: ['A', 'B', 'C'],
  expenses: [exRoundHalf], paidTransfers: [], me: '', roundingUnit: 100, roundingMode: 'round' };
assert.strictEqual(m.settlementText(evRoundModeText),
  '【わりかんメモ】合宿\nB → A：400円\nC → A：400円\n残り 800円（2件）');

// 21. v0.13 支出の記録日時：記録時に付き、編集・改名・読み込みで引き継がれる
// 記録時は現在時刻に近い値が入る
let before = Date.now();
let exDate = m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members }, members);
let afterDate = Date.now();
assert.ok(exDate.createdAt >= before && exDate.createdAt <= afterDate, '記録日時が現在時刻でない');
// 明示した日時はそのまま残る。不正な値は null になる
let exDateGiven = m.newExpense({ title: '宿', payer: 'A', amount: 9000, participants: members, createdAt: 1793123456789 }, members);
assert.strictEqual(exDateGiven.createdAt, 1793123456789);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 100, participants: members, createdAt: 'abc' }, members).createdAt, null);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 100, participants: members, createdAt: -1 }, members).createdAt, null);
assert.strictEqual(m.newExpense({ title: 'x', payer: 'A', amount: 100, participants: members, createdAt: 0 }, members).createdAt, null);
// 表示文：ローカル時刻で「月/日 時:分」。日時なし・不正は空文字
assert.strictEqual(m.formatExpenseDate(new Date(2026, 10, 13, 3, 5).getTime()), '11/13 03:05');
assert.strictEqual(m.formatExpenseDate(new Date(2026, 0, 2, 15, 30).getTime()), '1/2 15:30');
assert.match(m.formatExpenseDate(Date.now()), /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
assert.strictEqual(m.formatExpenseDate(null), '');
assert.strictEqual(m.formatExpenseDate('abc'), '');
assert.strictEqual(m.formatExpenseDate(0), '');
// 編集しても記録日時は変わらない
let editedDate = m.editExpense(exList, targetId,
  { title: '宿泊代', payer: 'B', amount: 6000, participants: ['A', 'B'] }, members);
assert.ok(editedDate);
assert.strictEqual(editedDate[0].createdAt, exList[0].createdAt);
// 改名しても記録日時は残る
let renamedDate = m.renameMember(evRename, 'B', 'B2');
assert.strictEqual(renamedDate.expenses[0].createdAt, evRename.expenses[0].createdAt);
// 読み込み：日時があるものは残り、ないものは null（読み込み時刻にしない）
let impDate = m.validateImport({ eventName: '合宿', members: ['A', 'B'], expenses: [
  { title: '宿', payer: 'A', amount: 2000, participants: ['A', 'B'], createdAt: 1793123456789 },
  { title: '昼食', payer: 'B', amount: 1000, participants: ['A', 'B'] },
]});
assert.strictEqual(impDate.expenses[0].createdAt, 1793123456789);
assert.strictEqual(impDate.expenses[1].createdAt, null);
// 保存形式の移行でも日時が残る
let storeDate = m.validateStore({ events: [
  { id: 'e1', eventName: '合宿', members: ['A', 'B'], expenses: [
    { title: '宿', payer: 'A', amount: 2000, participants: ['A', 'B'], createdAt: 1793123456789 },
  ] },
], activeEventId: 'e1' });
assert.strictEqual(storeDate.events[0].expenses[0].createdAt, 1793123456789);

// 22. v0.14 支出一覧の並び替え：記録日時で新しい順／古い順、元の配列は変えない
let exSort = [
  m.newExpense({ title: '古い', payer: 'A', amount: 100, participants: members, createdAt: 1000 }, members),
  m.newExpense({ title: '新しい', payer: 'A', amount: 200, participants: members, createdAt: 3000 }, members),
  m.newExpense({ title: '真ん中', payer: 'A', amount: 300, participants: members, createdAt: 2000 }, members),
];
assert.deepStrictEqual(m.sortExpenses(exSort, 'recorded').map(e => e.title), ['古い', '新しい', '真ん中']);
assert.deepStrictEqual(m.sortExpenses(exSort, 'newest').map(e => e.title), ['新しい', '真ん中', '古い']);
assert.deepStrictEqual(m.sortExpenses(exSort, 'oldest').map(e => e.title), ['古い', '真ん中', '新しい']);
// 日時のない支出は最も古いものとして扱う（新しい順では一番下、古い順では一番上）
let exSortOld = [
  m.newExpense({ title: '日時あり', payer: 'A', amount: 100, participants: members, createdAt: 1000 }, members),
  m.newExpense({ title: '日時なし', payer: 'A', amount: 200, participants: members, createdAt: 'abc' }, members),
];
assert.strictEqual(exSortOld[1].createdAt, null);
assert.deepStrictEqual(m.sortExpenses(exSortOld, 'newest').map(e => e.title), ['日時あり', '日時なし']);
assert.deepStrictEqual(m.sortExpenses(exSortOld, 'oldest').map(e => e.title), ['日時なし', '日時あり']);
// 同日時は記録順のまま、元の配列は変わらない、不正な指定は記録した順、空でも壊れない
let exSortSame = [
  m.newExpense({ title: '先', payer: 'A', amount: 100, participants: members, createdAt: 2000 }, members),
  m.newExpense({ title: '後', payer: 'A', amount: 200, participants: members, createdAt: 2000 }, members),
];
assert.deepStrictEqual(m.sortExpenses(exSortSame, 'newest').map(e => e.title), ['先', '後']);
assert.deepStrictEqual(m.sortExpenses(exSort, 'bogus').map(e => e.title), ['古い', '新しい', '真ん中']);
assert.deepStrictEqual(m.sortExpenses(exSort).map(e => e.title), ['古い', '新しい', '真ん中']);
assert.deepStrictEqual(exSort.map(e => e.title), ['古い', '新しい', '真ん中']); // 元の配列は変更しない
assert.deepStrictEqual(m.sortExpenses([], 'newest'), []);

console.log('全テスト通過 (22グループ)');
