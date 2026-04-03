#!/usr/bin/env node

const { spawn } = require('node:child_process')

const env = { ...process.env }

;(async() => {
  await exec('npx next build --experimental-build-mode generate')

  // launch application
  await exec(process.argv.slice(2).join(' '))
})()

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
