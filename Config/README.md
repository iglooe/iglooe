# Git setup for config

## email setup

```bash
git config --global user.name ""
```

```bash
git config --global user.email ""
```

## ssh

```bash
ssh-keygen -t ed25519 -C "email"
```

```bash
eval "$(ssh-agent -s)"
```

## optional

```bash
git config --global core.editor vim
```

```bash
git config --global init.defaultBranch main
```
