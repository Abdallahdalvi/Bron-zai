const simpleGit = require('simple-git');
const path = require('path');

const repoPath = 'C:\\Users\\CoreX\\.codex\\bron-main';
const remoteUrl = 'https://github.com/Abdallahdalvi/Bron-zai.git';

async function pushToGitHub() {
  const git = simpleGit(repoPath);
  
  try {
    // Check current remotes
    const remotes = await git.getRemotes(true);
    console.log('Current remotes:', remotes);
    
    // Add or update origin remote
    const originExists = remotes.some(r => r.name === 'origin');
    if (originExists) {
      await git.removeRemote('origin');
      console.log('Removed existing origin');
    }
    
    await git.addRemote('origin', remoteUrl);
    console.log('Added origin:', remoteUrl);
    
    // Get current branch
    const status = await git.status();
    const branch = status.current || 'main';
    console.log('Current branch:', branch);
    
    // Check if there are changes to commit
    if (status.files.length > 0) {
      console.log('Staging files...');
      await git.add('.gitignore');
      await git.add('./*');
      console.log('Committing changes...');
      await git.commit('Initial commit for Bron-zai project');
    }
    
    // Push to GitHub
    console.log('Pushing to GitHub...');
    await git.push('origin', branch, ['--force']);
    
    console.log('✅ Successfully pushed to', remoteUrl);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

pushToGitHub();
