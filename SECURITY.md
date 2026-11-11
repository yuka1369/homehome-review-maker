# セキュリティポリシー

## 脆弱性の報告
脆弱性を見つけた場合は、公開 Issue ではなく GitHub の
**Security → Report a vulnerability（Private vulnerability reporting）** からご報告ください。
（リポジトリ管理者は Settings → Code security で Private vulnerability reporting を有効にしてください）

## 設計上の方針
- 入力データを外部に送信しない（`connect-src 'none'`）
- ユーザー入力は `textContent` / Canvas でのみ出力し、HTML として解釈しない
- CSP でインラインスクリプト・外部スクリプトを禁止
- 実行時の外部依存なし

詳細は [設計書の「セキュリティ設計」](docs/design.md#4-セキュリティ設計) を参照してください。
