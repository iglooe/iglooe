bcdedit /timeout 2
bcdedit /set useplatformclock no
bcdedit /set disabledynamictick yes
bcdedit /set useplatformtick yes
bcdedit /set nx optout
bcdedit /set bootux disabled
bcdedit /set bootmenupolicy standard
bcdedit /set hypervisorlaunchtype off
bcdedit /set tpmbootentropy ForceDisable
bcdedit /set quietboot yes

