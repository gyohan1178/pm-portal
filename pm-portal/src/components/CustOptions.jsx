// 고객사 고르는 칸의 <option> 들 (v4.177.0) — 주요 고객사 다음에 「기타 고객사」 묶음 (lib/customers withEtcCustomers)
export default function CustOptions({ list = [] }) {
  const main = list.filter((c) => !c.etc)
  const etc = list.filter((c) => c.etc)
  return (
    <>
      {main.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      {etc.length > 0 && (
        <optgroup label="기타 고객사">
          {etc.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
    </>
  )
}
