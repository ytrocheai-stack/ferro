import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

it('mueve selección y foco juntos, incluido el regreso desde el último segmento', async () => {
  function Harness() {
    const [value, setValue] = useState('diary')
    return <SegmentedControl value={value} onChange={setValue} ariaLabel="Vista" options={[{ value: 'diary', label: 'Diario' }, { value: 'trends', label: 'Tendencias' }]} />
  }
  render(<Harness />)
  const user = userEvent.setup()
  await user.tab()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Tendencias', selected: true })).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Diario', selected: true })).toHaveFocus()
})
