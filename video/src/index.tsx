import { Composition, registerRoot } from 'remotion';
import { FolioFilm } from './Film';

function Root() {
  return (
    <Composition
      id="FolioIntro"
      component={FolioFilm}
      width={2560}
      height={1440}
      fps={30}
      durationInFrames={1800}
    />
  );
}

registerRoot(Root);
