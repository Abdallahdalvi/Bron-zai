const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const http = require('isomorphic-git/http/node');

const dir = 'C:\\Users\\CoreX\\.codex\\bron-main';
const url = 'https://github.com/Abdallahdalvi/Bron-zai.git';

async function push() {
  try {
    // List current remotes
    const remotes = await git.listRemotes({ fs, dir });
    console.log('Current remotes:', remotes);
    
    // Remove existing origin if present
    if (remotes.some(r => r.remote === 'origin')) {
      await git.deleteRemote({ fs, dir, remote: 'origin' });
    }
    
    // Add new remote
    await git.addRemote({ fs, dir, remote: 'origin', url });
    console.log('Added remote:', url);
    
    // Get current branch
    const branches = await git.listBranches({ fs, dir });
    console.log('Branches:', branches);
    
    // Try to push - this will need auth
    console.log('Attempting to push...');
    console.log('You may need to provide GitHub credentials.');
    
    // For now, just try with no auth (public repo push should fail with helpful message)
    await git.push({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: 'main',
      onAuth: () => {
        console.log('Authentication required!');
        console.log('Please enter your GitHub credentials in the browser or use a Personal Access Token.');
        // Return empty - will fail but show what we need
        return {};
      }
    });
    
    console.log('✅ Push successful!');
  } catch (err) {
    console.error('Error:', err.message);
    console.log('\nTo push to GitHub, you need to authenticate.');
    console.log('Options:');
    console.log('1. Open GitHub in browser and upload files manually');
    console.log('2. Install Git for Windows and use: git push origin main');
    console.log('3. Use GitHub Desktop');
  }
}

push();
