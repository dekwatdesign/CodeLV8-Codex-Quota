# Codex Quota

Widget แบบ always-on-top สำหรับดู quota ที่เหลือของ Codex/ChatGPT โดยแยกออกจาก Control Center ของ `codex-router` เป็นโปรเจกต์ Electron/React standalone แล้ว

แอปจะแสดงไอคอน **Codex Quota** ใน system tray ของ Windows เสมอ คลิกไอคอนเพื่อแสดง/ซ่อน overlay หรือคลิกขวาเพื่อเลือก Show, Hide และ Quit การปิด overlay จะซ่อนไว้ที่ tray โดยไม่หยุดการทำงานของแอป

## ใช้งาน

```powershell
.\Build-CodexQuota.ps1
.\Start-CodexQuota.ps1
```

ตัวติดตั้ง Windows 11 64-bit (x64/AMD64 ซึ่งใช้ได้กับทั้ง AMD และ Intel รุ่น x64) อยู่ที่ `release\Codex-Quota-1.2.0-x64.exe` ส่วนไฟล์แพ็กแบบ unpacked อยู่ที่ `release\win-unpacked\Codex Quota.exe` ชื่อผลิตภัณฑ์และชื่อหน้าต่างคือ **Codex Quota** ตัวติดตั้งเป็น NSIS แบบ wizard ติดตั้งต่อผู้ใช้และเลือกโฟลเดอร์ปลายทางได้

เมื่อกดลูกศรเพื่อขยายรายละเอียด จะมีตัวเลือก **เริ่มพร้อม Windows** ในส่วนการตั้งค่า ค่าเริ่มต้นปิดอยู่ และสถานะจะถูกบันทึกไว้ใน settings ของแอป เมื่อเปิดไว้ แอปจะลงทะเบียนเป็น Windows login item และเปิด overlay หลังเข้าสู่ระบบครั้งถัดไป

## อัปเดตอัตโนมัติ

ตัวติดตั้งแบบแพ็กเกจจะตรวจสอบ GitHub Releases ของ `dekwatdesign/CodeLV8-Codex-Quota` เมื่อเปิดแอปและทุก 6 ชั่วโมง แอปจะดาวน์โหลด release ล่าสุดที่เป็น stable ให้เบื้องหลัง เมื่อดาวน์โหลดเสร็จจะแสดงปุ่ม **ติดตั้ง** ในรายละเอียดของ overlay และยังติดตั้งให้อัตโนมัติเมื่อปิดแอปตามปกติ การตรวจสอบจะปิดไว้ในโหมดพัฒนาและโหมด `-Demo`

การ build ด้วย `electron-builder` จะสร้าง `latest.yml` และ blockmap สำหรับกลไกนี้โดยอัตโนมัติ ดังนั้น release ใหม่บน GitHub ต้องแนบไฟล์ metadata ที่สร้างจากคำสั่ง build เดียวกันและใช้ tag แบบ `v<version>`

สำหรับตรวจ layout โดยไม่ต้องพึ่งบัญชีที่ล็อกอิน ให้ใช้ข้อมูลจำลองชั่วคราว:

```powershell
.\Start-CodexQuota.ps1 -Demo
```

## แหล่งข้อมูลและขอบเขตความปลอดภัย

- แอปค้นหา Codex Desktop binary ที่ใช้งานจริง (รวม path แบบ version-hashed ของ Windows และ `.cmd` shim) แล้วเรียก `codex app-server` แบบ one-shot ตามแนวทางของ `codex-router`
- หลัง `initialize` แอปส่ง notification `initialized` แล้วอ่าน JSON-RPC methods `account/rateLimits/read` และ `account/usage/read`
- ไม่อ่าน `auth.json` และไม่ส่งข้อมูลออกนอกเครื่อง
- quota หลักและ quota รายสัปดาห์รีเฟรชจาก account snapshot ใหม่ทุก 45 วินาที
- ตัวเลขกิจกรรม `active`, `today`, `t/s` จะแสดงค่าที่ปลอดภัยเมื่อไม่มี telemetry จาก router แยกต่างหาก

## Layout ที่แก้ไข

ส่วน `Quota remaining` เป็น flex item ที่ยืดเต็มพื้นที่ที่เหลือของ widget และ progress bar ใช้ `width: 100%` ของคอลัมน์ quota จึงไม่ถูกบีบเหลือครึ่งเดียวเมื่อมีปุ่ม expand อยู่ด้านขวา

ใต้แต่ละ progress bar จะแสดงเวลารีเซ็ตถัดไปตามเขตเวลาของเครื่อง เมื่อ account snapshot มีค่า `resetsAt` หรือ `resetAt`

- รายละเอียด activity จะขยายหรือย่อเมื่อกดปุ่มลูกศร `Expand activity details` เท่านั้น
- คลิกค้างแล้วลากพื้นที่ widget เพื่อย้ายตำแหน่งได้ และตำแหน่งล่าสุดจะถูกจำไว้ใน settings ของแอป
- ใช้ฟอนต์ `LINE Seed Sans TH` จาก LINE Seed ทั้งภาษาไทยและภาษาอังกฤษ
  ต้นฉบับฟอนต์: https://seed.line.me/src/images/fonts/LINE_Seed_Sans_TH.zip

## ทดสอบ

```powershell
npm ci
npm run check
npm test
npm run electron:build
```

คำสั่ง build จะสร้างทั้ง installer NSIS x64 และแพ็กเกจ `win-unpacked` สำหรับตรวจสอบเบื้องต้น

การทดสอบ renderer ใช้ข้อมูล quota 92% และ 40% ตรวจความกว้างจริงของคอลัมน์และ progress bar ที่ viewport 456px รวมถึงตรวจชื่อผลิตภัณฑ์ `Codex Quota`
