import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.mjs';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.stdin.isTTY) { console.error('Run interactively: node scripts/reset-password.mjs your@email.com'); process.exit(1); }
async function hidden(prompt) {
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
  return new Promise((resolve,reject)=>{let value='';const cleanup=()=>{process.stdin.removeListener('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};function read(chunk){for(const char of chunk){if(char==='\u0003'){cleanup();reject(new Error('Cancelled.'));return;}if(char==='\r'||char==='\n'){cleanup();resolve(value);return;}if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);}else if(char>=' '&&char!=='\u001b'){value+=char;}}}process.stdin.on('data',read);});
}
let db;
try {
  const password=await hidden('New password (input hidden): '),confirmation=await hidden('Confirm password (input hidden): ');
  if(password.length<10||password.length>128)throw new Error('Use a password of 10–128 characters.');
  if(password!==confirmation)throw new Error('Passwords do not match.');
  const filename=process.env.DB_PATH||resolve(fileURLToPath(new URL('../',import.meta.url)),'data/family.sqlite');db=openStore(filename);
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email);if(!user)throw new Error('Account not found.');
  const salt=randomBytes(16).toString('hex'),digest=(await promisify(scrypt)(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
  db.exec('BEGIN');try{db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,digest,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  console.log('Password reset. All existing sessions for this account have been signed out.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{db?.close();}
