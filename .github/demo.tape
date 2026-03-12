# VHS Tape for Probe CLI Demo
# https://github.com/charmbracelet/vhs

Output demo.gif

Set FontSize 16
Set Width 1200
Set Height 600
Set Padding 20
Set Theme "Seti"

# Show probe help
Type "probe" Sleep 500ms
Enter Sleep 2s

# Clear screen
Type "clear" Sleep 300ms
Enter Sleep 500ms

# Show whoami
Type "probe whoami" Sleep 500ms
Enter Sleep 2s

# Show task list
Type "probe task list --limit 3" Sleep 500ms
Enter Sleep 2s

# Show SQL query
Type `probe query "SELECT id, name, role, status FROM agents LIMIT 5"` Sleep 500ms
Enter Sleep 3s

# End
Sleep 1s
